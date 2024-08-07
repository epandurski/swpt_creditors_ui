import type { DocumentRecord, TransferRecord, DebtorDataSource } from './db'
import type { DebtorData, BaseDebtorData } from '../debtor-info'
import type { ServerSession, HttpResponse, PaginatedList, Transfer } from './server'
import type { AccountV0, TransferV0, LedgerEntryV0, DebtorInfoV0 } from './canonical-objects'

import { HttpError } from './server'
import {
  makeLedgerEntry, makeObjectReference, makeTransfersList, makeAccountsList, makeTransfer
} from './canonical-objects'
import { getDocumentRecord, putDocumentRecord, getBaseDebtorDataFromAccoutKnowledge } from './db'
import { parseDebtorInfoDocument, sanitizeBaseDebtorData, InvalidDocument } from '../debtor-info'

export const MAX_INT64 = (1n << 63n) - 1n

export class InvalidCoinUri extends Error {
  name = 'InvalidCoinUri'
}

export class DocumentFetchError extends Error {
  name = 'DocumentFetchError'
}

export function calcParallelTimeout(numberOfParallelRequests: number): number {
  const n = 6  // a rough guess for the maximum number of parallel connections
  return appConfig.serverApiTimeout * (numberOfParallelRequests + n - 1) / n
}

export async function fetchWithTimeout(resource: RequestInfo, options: RequestInit & { timeout?: number }) {
  const { timeout } = options;

  if (timeout === undefined) {
    return await fetch(resource, options);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  const response = await fetch(resource, {
    ...options,
    signal: controller.signal
  });
  clearTimeout(timeoutId);

  return response;
}

export const iterAccountsList = (
  server: ServerSession,
  accountsListUri: string,
) => iterPaginatedList(server, accountsListUri, makeAccountsList, makeObjectReference)

export const iterTransfersList = (
  server: ServerSession,
  transfersListUri: string,
) => iterPaginatedList(server, transfersListUri, makeTransfersList, makeObjectReference)

export async function fetchTransfers(server: ServerSession, uris: string[]): Promise<TransferV0[]> {
  const timeout = calcParallelTimeout(uris.length)
  const responsePromises = uris.map(uri => server.get(uri, { timeout }) as Promise<HttpResponse<Transfer>>)
  const responses = await settleAndIgnore404(responsePromises)
  return responses.map(response => makeTransfer(response))
}

export async function settleAndIgnore404<T>(responsePromises: Promise<HttpResponse<T>>[]): Promise<HttpResponse<T>[]> {
  const results = await Promise.allSettled(responsePromises)
  const rejected = results.filter(x => x.status === 'rejected') as PromiseRejectedResult[]
  const errors = rejected.map(x => x.reason)
  for (const e of errors) {
    if (e instanceof HttpError && e.status === 404) { /* ingnore */ }
    else throw e
  }
  const fulfilled = results.filter(x => x.status === 'fulfilled') as PromiseFulfilledResult<HttpResponse<T>>[]
  const responses = fulfilled.map(x => x.value)
  return responses
}

export async function fetchNewLedgerEntries(
  server: ServerSession,
  firstUri: string,  // the URI of the first page containing ledger entries
  knownEntryId: bigint,  // the ID of the earliest known entry
  stopEntryId: bigint,  // the ID of the latest uninteresting entry
  options: { timeout?: number, attemptLogin?: boolean } = {},
): Promise<LedgerEntryV0[]> {
  let newLedgerEntries: LedgerEntryV0[] = []

  // NOTE: The entries are iterated in reverse-chronological order
  // (bigger entryIds go first).
  if (stopEntryId + 1n < knownEntryId) {
    const first = new URL(firstUri)
    first.searchParams.append('stop', String(stopEntryId))
    try {
      for await (const entry of iterLedgerEntries(server, first.href, options)) {
        const { entryId } = entry
        if (entryId >= knownEntryId) {
          continue  // This is an alredy known entry.
        }
        if (knownEntryId - entryId !== 1n) {
          break  // There are missing entries.
        }
        if (entryId <= stopEntryId) {
          break  // This is an uninteresting entry.
        }
        newLedgerEntries.push(entry)
        knownEntryId = entryId
      }
    } catch (e: unknown) {
      if (e instanceof HttpError && e.status === 404) { /* The account seems to have been deleted. */ }
      else throw e
    }
  }
  return newLedgerEntries
}

export function buffer2hex(buffer: ArrayBuffer, options = { toUpperCase: true }) {
  const bytes = [...new Uint8Array(buffer)]
  const hex = bytes.map(n => n.toString(16).padStart(2, '0')).join('')
  return options.toUpperCase ? hex.toUpperCase() : hex
}

export async function calcSha256(buffer: ArrayBuffer): Promise<string> {
  return buffer2hex(await crypto.subtle.digest('SHA-256', buffer))
}

export async function fetchDebtorInfoDocument(
  documentIri: string,
  timeout: number = appConfig.serverApiTimeout,
): Promise<DocumentRecord> {
  let documentUri: string
  try {
    documentUri = new URL(documentIri).href
  } catch {
    throw new DocumentFetchError()
  }
  let document = await getDocumentRecord(documentUri)
  if (!document) {
    let response, content
    try {
      response = await fetchWithTimeout(documentUri, { timeout })
      if (!response.ok) throw new Error()
      content = await response.arrayBuffer()
    } catch (e:unknown) {
      console.warn(e)
      throw new DocumentFetchError()
    }
    document = {
      content,
      contentType: response.headers.get('Content-Type') ?? 'text/plain',
      sha256: await calcSha256(content),
      uri: response.url,
    }
  }
  return document
}

type Page<ItemsType> = {
  items: ItemsType[],
  next?: string,
}

const iterLedgerEntries = (
  server: ServerSession,
  firstPageUri: string,
  options: { timeout?: number, attemptLogin?: boolean } = {},
) => iterPages(server, firstPageUri, makeLedgerEntry, options)

async function* iterPages<OriginalItem, TransformedItem>(
  server: ServerSession,
  next: string,
  transformItem: (item: OriginalItem, pageUrl: string) => TransformedItem,
  options: { timeout?: number, attemptLogin?: boolean } = {},
): AsyncIterable<TransformedItem> {
  do {
    const pageResponse = await server.get(next, options) as HttpResponse<Page<OriginalItem>>
    const pageUrl = pageResponse.url
    const data = pageResponse.data
    assert(data.next === undefined || typeof data.next === 'string')
    assert(data.items instanceof Array)

    for (const item of data.items) {
      yield transformItem(item, pageUrl)
    }
    next = data.next !== undefined ? pageResponse.buildUri(data.next) : ''
  } while (next)
}

async function* iterPaginatedList<OriginalItem, TransformedItem>(
  server: ServerSession,
  listUri: string,
  makeList: (response: HttpResponse<PaginatedList>) => PaginatedList,
  transformItem: (item: OriginalItem, pageUrl: string) => TransformedItem,
): AsyncIterable<TransformedItem> {
  const response = await server.get(listUri) as HttpResponse<PaginatedList>
  const list = makeList(response)
  yield* iterPages(server, list.first, transformItem)
}

export async function getDataFromDebtorInfo(debtorInfo: DebtorInfoV0, debtorIdentityUri: string): Promise<DebtorData> {
  const document = await fetchDebtorInfoDocument(debtorInfo.iri)
  if (!await putDocumentRecord(document)) {
    // This could happen if an extremely unusual (but still
    // possible) race condition had occurred. In this case the
    // user will have to simply retry the action.
    throw new DocumentFetchError()
  }
  const debtorData = parseDebtorInfoDocument(document)
  if (debtorInfo.sha256 !== undefined && document.sha256 !== debtorInfo.sha256) {
    throw new InvalidDocument('wrong SHA256 value')
  }
  if (debtorInfo.contentType !== undefined && document.contentType !== debtorInfo.contentType) {
    throw new InvalidDocument('wrong content type')
  }
  if (debtorData.debtorIdentity.uri !== debtorIdentityUri) {
    throw new InvalidDocument('wrong debtor identity')
  }
  return debtorData
}

function getFailureReason(errorCode: string): string {
  switch (errorCode) {
    case 'CANCELED_BY_THE_SENDER':
      return 'The payment has been canceled by the sender.'
    case 'SENDER_IS_UNREACHABLE':
      return "The sender's account does not exist, or can not make outgoing transfers."
    case 'RECIPIENT_IS_UNREACHABLE':
      return "The recipient's account does not exist, or does not accept incoming payments."
    case 'RECIPIENT_SAME_AS_SENDER':
      return "The recipient's account is the same as the sender's account."
    case 'NO_RECIPIENT_CONFIRMATION':
      return "A confirmation from the recipient is required, but has not been obtained."
    case 'TRANSFER_NOTE_IS_TOO_LONG':
      return "The byte-length of the payment note is too big."
    case 'INSUFFICIENT_AVAILABLE_AMOUNT':
      return "The requested amount is not available on the sender's account."
    case 'TIMEOUT':
      return "The payment has been terminated due to expired deadline."
    case 'NEWER_INTEREST_RATE':
      return "The payment has been terminated because the current interest rate on the"
        + " account is more recent than the specified final interest rate timestamp."
    default:
      return errorCode
  }
}

/* Obtain and return debtor's data. The caller must be prepared this
 * function to throw `InvalidDocument` or `DocumentFetchError` */
export async function obtainBaseDebtorData(
  account: AccountV0,
  latestDebtorInfoUri: string,
): Promise<{ debtorData: BaseDebtorData, debtorDataSource: DebtorDataSource, hasDebtorInfo: boolean }> {
  const getFromDebtorInfo = async (debtorInfo: DebtorInfoV0): Promise<BaseDebtorData> => {
    const debtorData = await getDataFromDebtorInfo(debtorInfo, account.debtor.uri)
    return sanitizeBaseDebtorData(debtorData)
  }
  const hasDebtorInfo = account.info.debtorInfo !== undefined
  if (account.display.debtorName !== undefined) {
    return {
      debtorData: getBaseDebtorDataFromAccoutKnowledge(account.knowledge),
      debtorDataSource: 'knowledge',
      hasDebtorInfo,
    }
  } else if (account.info.debtorInfo !== undefined) {
    return {
      debtorData: await getFromDebtorInfo(account.info.debtorInfo),
      debtorDataSource: 'info',
      hasDebtorInfo,
    }
  } else {
    return {
      debtorData: await getFromDebtorInfo({ type: 'DebtorInfo' as const, iri: latestDebtorInfoUri }),
      debtorDataSource: 'uri',
      hasDebtorInfo,
    }
  }
}

export function getTransferStatusDetails(t: TransferRecord): string {
  let tooltip = `The payment was initiated at ${new Date(t.initiatedAt).toLocaleString()}`
  if (t.result) {
    const finalizedAt = new Date(t.result.finalizedAt).toLocaleString()
    if (t.result.error) {
      const reason = getFailureReason(t.result.error.errorCode)
      tooltip += `, and failed at ${finalizedAt}.`
      tooltip += `The reason for the failure is: ${reason}`
    } else {
      tooltip += `, and succeeded at ${finalizedAt}.`
      const paymentRefernece = t.paymentInfo.payeeReference
      if (paymentRefernece) {
        const maxLength = 64
        const shortRef = paymentRefernece.length <= maxLength
          ? paymentRefernece
          : `${paymentRefernece.slice(0, maxLength)}...`
        tooltip += ` The payment reference is: "${shortRef}".`
      }
    }
  } else {
    tooltip += '.'
  }
  return tooltip
}
