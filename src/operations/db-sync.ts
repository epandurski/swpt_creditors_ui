import type {
  ServerSession, HttpResponse, Creditor, PinInfo, Wallet, Account, LogEntriesPage
} from './server'
import type {
  AccountLedgerRecord, TransferRecord, AccountRecord, AccountConfigRecord, PinInfoRecord,
  AccountDisplayRecord, AccountKnowledgeRecord, AccountExchangeRecord, AccountInfoRecord,
  CommittedTransferRecord, CreditorRecord, AccountObjectRecord
} from './db'
import type {
  PinInfoV0, CreditorV0, WalletV0, AccountV0, TransferV0, LogEntryV0, TransferResultV0, LogObject,
  AccountConfigV0, AccountDisplayV0, AccountKnowledgeV0, AccountExchangeV0, AccountLedgerV0,
  CommittedTransferV0
} from './canonical-objects'

import { v4 as uuidv4 } from 'uuid';
import { HttpError } from './server'
import {
  db, storeCommittedTransferRecord, deleteAccountObject, deleteAccount, storeLedgerEntryRecord, splitIntoRecords,
  updateWalletRecord, getWalletRecord, getUserId, registerTranferDeletion, getTransferRecord, storeTransfer,
  resolveOldNotConfirmedCreateTransferRequests, storeAccountKnowledgeRecord, storeAccountInfoRecord,
  postAccountsMapMessage, verifyAccountKnowledge, getEntryIdString, detectDelayedTransfers
} from './db'
import {
  makeCreditor, makePinInfo, makeAccount, makeWallet, makeLogObject, makeLogEntriesPage,
  getCanonicalType
} from './canonical-objects'
import {
  iterAccountsList, calcParallelTimeout, fetchNewLedgerEntries, iterTransfersList, fetchTransfers,
  settleAndIgnore404, MAX_INT64
} from './utils'

export class BrokenLogStream extends Error {
  name = 'BrokenLogStream'
}

export class PinNotRequired extends Error {
  name = 'PinNotRequired'
}

export const IS_A_NEWBIE_KEY = 'creditors.IsANewbie'
export const HAS_NOT_CREATED_PEG_ACCOUNT = 'creditors.HasNotCreatedPegAccount'
export const HAS_RECEIVED_TRADE_INSTRUCTIONS = 'creditors.HasReceivedTradeInstructions'

export const currentWindowUuid = uuidv4()

export type UserResetMessage = {
  userId: number,
  windowUuid: string,  // the UUID of the window that preforms the reset
}

/* This channel is used to signal that user's data is about to be
 * reset (deleted and re-created again).
 */
export const userResetsChannel = new BroadcastChannel('creditors.userResets')

/* Returns the user ID corresponding to the given `entrypoint`. If the
 * user does not exist or some log entries have been lost, tries to
 * create/reset the user, reading the user's data from the server. */
export async function getOrCreateUserId(server: ServerSession, entrypoint: string): Promise<number> {
  let userId = await getUserId(entrypoint)
  if (userId === undefined || (await getWalletRecord(userId)).logStream.isBroken) {
    const userData = await getUserData(server)
    userId = await storeUserData(userData)
  }
  return userId
}

/* Queries the server for the latest changes and updates the local
 * database accordingly. Throws `PinNotRequired` if PIN is not
 * required for potentially dangerous operations.*/
export async function sync(server: ServerSession, userId: number): Promise<void> {
  await fetchWallet(server, userId)
  try {
    await ensureLoadedTransfers(server, userId)
    while (await processLogPage(server, userId));
    await resolveOldNotConfirmedCreateTransferRequests(userId)
    await detectDelayedTransfers(userId)
  } catch (e: unknown) {
    if (e instanceof BrokenLogStream) {
      console.warn('Failed to synchronize with the server. The app is being automatically restarted.')
      location.reload()
    } else throw e
  }
}

/* Stores an object received from a direct HTTP request to the
 * server. */
export async function storeObject(
  userId: number,
  obj: TransferV0 | AccountV0 | AccountConfigV0 | AccountDisplayV0 |
    AccountKnowledgeV0 | AccountExchangeV0 | PinInfoV0 | CommittedTransferV0
): Promise<void> {
  switch (obj.type) {
    case 'Transfer':
      await storeTransfer(userId, obj)
      break
    case 'Account':
      const records = splitIntoRecords(userId, obj)

      // Because here we do not have the corresponding ledger entries,
      // and we do not want to have missing ledger entries for the
      // account, here we do not update the ledger record it exists
      // already. To achieve this, we explicitly set the earliest
      // possible version for the received ledger record.
      records.accountLedgerRecord.latestUpdateId = 1n

      await db.transaction('rw', db.allTables, async (): Promise<void> => {
        // NOTE: In the following sequence, the `AccountInfo` record
        // must be revised (updated) before the `AccountKnowledge`
        // record.
        await reviseLogObjectRecord(records.accountLedgerRecord)
        await reviseLogObjectRecord(records.accountInfoRecord)
        await reviseLogObjectRecord(records.accountDisplayRecord)
        await reviseLogObjectRecord(records.accountKnowledgeRecord)
        await reviseLogObjectRecord(records.accountExchangeRecord)
        await reviseLogObjectRecord(records.accountConfigRecord)
        await reviseLogObjectRecord(records.accountRecord)
      })
      break
    default:
      await reviseLogObjectRecord({ ...obj, userId })
  }
}

/* Reads the wallet from the server and updates the wallet
 * record. Throws `PinNotRequired` if PIN is not required for
 * potentially dangerous operations. */
async function fetchWallet(server: ServerSession, userId: number): Promise<void> {
  const wallet = makeWallet(await server.getEntrypointResponse() as HttpResponse<Wallet>)

  await db.transaction('rw', db.allTables, async () => {
    let walletRecord = await getWalletRecord(userId)

    // Most of the fields in the wallet are URIs that must not change.
    assert(walletRecord.uri === wallet.uri)
    assert(walletRecord.creditor.uri === wallet.creditor.uri)
    assert(walletRecord.pinInfo.uri === wallet.pinInfo.uri)
    assert(walletRecord.debtorLookup.uri === wallet.debtorLookup.uri)
    assert(walletRecord.accountLookup.uri === wallet.accountLookup.uri)
    assert(walletRecord.createTransfer.uri === wallet.createTransfer.uri)
    assert(walletRecord.createAccount.uri === wallet.createAccount.uri)
    assert(walletRecord.accountsList.uri === wallet.accountsList.uri)
    assert(walletRecord.transfersList.uri === wallet.transfersList.uri)

    walletRecord.logRetentionDays = wallet.logRetentionDays
    await updateWalletRecord(walletRecord)
  })

  if (!wallet.requirePin) {
    throw new PinNotRequired()
  }
}

/* Ensures that the initial loading of transfers from the server to
 * the local database has finished successfully. This must be done
 * before the synchronization via the log stream can start. Throws
 * `BrokenLogStream` if the log stream is broken. */
async function ensureLoadedTransfers(server: ServerSession, userId: number): Promise<void> {
  let walletRecord
  while (
    walletRecord = await getWalletRecord(userId),
    !walletRecord.logStream.isBroken && !walletRecord.logStream.loadedTransfers
  ) {
    const latestEntryId = walletRecord.logStream.latestEntryId
    for await (const transfer of iterTransfersToLoad(server, walletRecord.transfersList.uri)) {
      await storeObject(userId, transfer)
    }
    // Mark the log stream as redy for updates. Note that before we
    // start, we ensure that the status of the log stream had not been
    // changed by a parallel update.
    await db.transaction('rw', db.allTables, async () => {
      const walletRecord = await getWalletRecord(userId)
      if (
        !walletRecord.logStream.isBroken
        && !walletRecord.logStream.loadedTransfers
        && walletRecord.logStream.latestEntryId === latestEntryId
      ) {
        walletRecord.logStream.loadedTransfers = true
        await updateWalletRecord(walletRecord)
      }
    })
  }
  if (walletRecord.logStream.isBroken) {
    throw new BrokenLogStream()
  }
}

/* Connects to the server, processes one page of log entries and
 * updates the wallet record. Throws `BrokenLogStream` if the log
 * stream is broken. Returns `true` if there are more log pages to
 * process. */
async function processLogPage(server: ServerSession, userId: number): Promise<boolean> {
  const walletRecord = await getWalletRecord(userId)
  if (walletRecord.logStream.isBroken) {
    throw new BrokenLogStream()
  }
  if (!walletRecord.logStream.loadedTransfers) {
    return false
  }
  const previousEntryId = walletRecord.logStream.latestEntryId
  const now = new Date()

  try {
    const pageUrl = walletRecord.logStream.forthcoming
    const page = makeLogEntriesPage(await server.get(pageUrl) as HttpResponse<LogEntriesPage>)
    const isLastPage = page.next === undefined
    const [updates, latestEntryId] = collectObjectUpdates(page.items, previousEntryId)
    const objectUpdaters = await generateObjectUpdaters(updates, server, userId)

    // Write all object updates to the local database, and store the
    // current position in the log stream. Note that before we start,
    // we ensure that the status of the log stream had not been
    // changed by a parallel update.
    await db.transaction('rw', db.allTables, async () => {
      const walletRecord = await getWalletRecord(userId)
      if (
        !walletRecord.logStream.isBroken
        && walletRecord.logStream.loadedTransfers
        && walletRecord.logStream.latestEntryId === previousEntryId
      ) {
        for (const performObjectUpdate of objectUpdaters) {
          await performObjectUpdate()
        }
        if (isLastPage) {
          walletRecord.logStream.syncedAt = now
        }
        walletRecord.logStream.forthcoming = (isLastPage ? page.forthcoming : page.next) as string
        walletRecord.logStream.latestEntryId = latestEntryId
        await updateWalletRecord(walletRecord)
      }
    })
    return !isLastPage

  } catch (e: unknown) {
    if (e instanceof BrokenLogStream) {
      // Mark the log stream as broken and re-throw. Note that before
      // we start, we ensure that the status of the log stream had not
      // been changed by a parallel update.
      await db.transaction('rw', db.allTables, async () => {
        const walletRecord = await getWalletRecord(userId)
        if (
          !walletRecord.logStream.isBroken
          && walletRecord.logStream.loadedTransfers
          && walletRecord.logStream.latestEntryId === previousEntryId
        ) {
          walletRecord.logStream.isBroken = true
          await updateWalletRecord(walletRecord)
        }
      })
    }
    throw e
  }
}

type ObjectUpdater = () => Promise<void>

type LogObjectType =
  | 'Account'
  | 'AccountConfig'
  | 'AccountDisplay'
  | 'AccountKnowledge'
  | 'AccountExchange'
  | 'AccountInfo'
  | 'AccountLedger'
  | 'Transfer'
  | 'CommittedTransfer'
  | 'Creditor'
  | 'PinInfo'

type LogObjectRecord =
  | AccountRecord
  | AccountConfigRecord
  | AccountDisplayRecord
  | AccountKnowledgeRecord
  | AccountExchangeRecord
  | AccountInfoRecord
  | AccountLedgerRecord
  | TransferRecord
  | CommittedTransferRecord
  | CreditorRecord
  | PinInfoRecord

type UpdateInfo = {
  objectUri: string,
  objectType: LogObjectType,
  addedAt: string,
  deleted: boolean,
  objectUpdateId: bigint,
  data?: { [key: string]: unknown },
}

type UserData = {
  accounts: AccountV0[],
  wallet: WalletV0,
  creditor: CreditorV0,
  pinInfo: PinInfoV0,
}

class PreparedUpdate {
  constructor(public updater: ObjectUpdater, public relatedUpdates: UpdateInfo[] = []) { }
}

async function getUserData(server: ServerSession): Promise<UserData> {
  const wallet = makeWallet(await server.getEntrypointResponse() as HttpResponse<Wallet>)
  const creditor = makeCreditor(await server.get(wallet.creditor.uri) as HttpResponse<Creditor>)
  const pinInfo = makePinInfo(await server.get(wallet.pinInfo.uri) as HttpResponse<PinInfo>)

  const accountUris = []
  for await (const { uri } of iterAccountsList(server, wallet.accountsList.uri)) {
    accountUris.push(uri)
  }
  const timeout = calcParallelTimeout(accountUris.length)
  const promises = accountUris.map(uri => server.get(uri, { timeout })) as Promise<HttpResponse<Account>>[]
  const accountResponses = await settleAndIgnore404(promises)
  const accounts = accountResponses.map(response => makeAccount(response))

  return { wallet, creditor, pinInfo, accounts }
}

function setIsANewbieFlag(hasAccounts: boolean): void {
  const value = localStorage.getItem(IS_A_NEWBIE_KEY)
  if (value === null || value === 'true') {
    const updatedValue = hasAccounts ? 'false' : 'true'
    localStorage.setItem(IS_A_NEWBIE_KEY, updatedValue)
    localStorage.setItem(HAS_NOT_CREATED_PEG_ACCOUNT, updatedValue)
  }
}

function postUserResetsChannelMessage(userId: number): void {
  const message: UserResetMessage = { userId, windowUuid: currentWindowUuid }
  userResetsChannel.postMessage(message)
}

async function storeUserData({ accounts, wallet, creditor, pinInfo }: UserData): Promise<number> {
  // NOTE: This function wipes out user's wallet and account data, and
  // recreates it anew. Currently, it seems that existing actions and
  // tasks belonging to the user do not need to be deleted.

  return await db.transaction('rw', db.allTables, async () => {
    let userId = await getUserId(wallet.uri)
    if (userId === undefined || (await getWalletRecord(userId)).logStream.isBroken) {
      const { requirePin, log, logLatestEntryId, ...walletRecord } = {
        ...wallet,
        logStream: {
          latestEntryId: wallet.logLatestEntryId,
          forthcoming: wallet.log.forthcoming,
          loadedTransfers: false,
          isBroken: false,
        },
      }
      userId = await db.wallets.put({ ...walletRecord, userId })
      postUserResetsChannelMessage(userId)

      await db.walletObjects.put({ ...creditor, userId })
      await db.walletObjects.put({ ...pinInfo, userId })

      const oldAccountUris = new Set(await db.accounts.where({ userId }).primaryKeys())
      const oldAccountObjectRecords = await db.accountObjects.where({ userId }).toArray()
      oldAccountObjectRecords.forEach(record => oldAccountUris.add(record.account.uri))

      for (const account of accounts) {
        const records = splitIntoRecords(userId, account)
        await db.accounts.put(records.accountRecord)
        await db.accountObjects.bulkPut([
          records.accountDisplayRecord,
          records.accountKnowledgeRecord,
          records.accountExchangeRecord,
          records.accountLedgerRecord,
          records.accountConfigRecord,
        ])
        // For the account info records we must ensure that, if
        // needed, a `FetchDebtorInfo` task, and an `AckAccountInfo`
        // action get created. Note that `storeAccountInfoRecord` is
        // called only after all the other account objects have been
        // created.
        await storeAccountInfoRecord(records.accountInfoRecord)

        oldAccountUris.delete(account.uri)
      }
      for (const accountUri of oldAccountUris.keys()) {
        await deleteAccount(accountUri)
      }

      setIsANewbieFlag(accounts.length !== 0)
    }
    return userId
  })
}

function collectObjectUpdates(logEntries: LogEntryV0[], latestEntryId: bigint): [UpdateInfo[], bigint] {
  const updates: UpdateInfo[] = []
  for (const { entryId, addedAt, object: { uri }, objectType, objectUpdateId, deleted, data } of logEntries) {
    if (entryId !== ++latestEntryId) {
      throw new BrokenLogStream()
    }
    const canonicalType = getCanonicalType(objectType)
    if (
      canonicalType !== undefined
      && canonicalType !== 'AccountsList'
      && canonicalType !== 'TransfersList'
    ) {
      // NOTE: We ignore unknown log object types. Also, we ignore
      // changes in `TransfersList` and `AccountsList` objects,
      // because we do not need the information contained in them to
      // properly maintain transfers and account lists.
      updates.push({
        objectUri: uri,
        objectType: canonicalType,
        objectUpdateId: objectUpdateId ?? MAX_INT64,
        addedAt,
        deleted,
        data,
      })
    }
  }
  return [updates, latestEntryId]
}

async function generateObjectUpdaters(
  updates: UpdateInfo[],
  server: ServerSession,
  userId: number,
  objCache: Map<string, LogObject | '404'> = new Map(),
  pendingUpdates: Map<string, UpdateInfo> = new Map(),
): Promise<ObjectUpdater[]> {
  const uniqueUpdates = removeRedundantUpdates(updates, pendingUpdates)
  const timeout = calcParallelTimeout(uniqueUpdates.length)
  const promises = Promise.all(uniqueUpdates.map(update => prepareUpdate(update, objCache, server, userId, timeout)))
  let updaters: ObjectUpdater[] = []
  let relatedUpdatesList: UpdateInfo[] = []
  for (const { updater, relatedUpdates } of await promises) {
    updaters.push(updater)
    relatedUpdatesList.push(...relatedUpdates)
  }
  if (relatedUpdatesList.length > 0) {
    // When some of the updated objects are related to other objects
    // by foreign keys, the referred objects should be requested from
    // the server as well. We do this recursively here. Infinite
    // cycles should be impossible, because we use `pendingUpdates` to
    // remember which updates have already started, and do not start
    // them the second time.
    updaters = updaters.concat(
      await generateObjectUpdaters(relatedUpdatesList, server, userId, objCache, pendingUpdates))
  }
  return updaters
}

function removeRedundantUpdates(updates: UpdateInfo[], pendingUpdates: Map<string, UpdateInfo>): UpdateInfo[] {
  let updatesMap = new Map<string, UpdateInfo>()
  updates.forEach(update => {
    // Add the URI of the update to `pendingUpdates` and `updatesMap`,
    // but only if the same or newer update is not already pending.
    const { objectUri, objectUpdateId } = update
    const pendingUpdate = pendingUpdates.get(objectUri)
    if (!pendingUpdate || pendingUpdate.objectUpdateId < objectUpdateId) {
      pendingUpdates.set(objectUri, update)
      updatesMap.set(objectUri, update)
    }
  })

  // NOTE: Here we make sure that all `AccountInfo `updates are sorted
  // before the other updates. But in fact, the only important thing
  // is that for each given account, the update of the `AccountInfo`
  // record is done before the update of the `AccountKnowledge`
  // record. This (hopefully) guarantees that `AckAccountInfoAction`s
  // claiming that the account's info has been reverted to its
  // previous version will never be created.
  return [...updatesMap.values()].sort(orderAccountInfosBeforeOthers)
}

function orderAccountInfosBeforeOthers(a: UpdateInfo, b: UpdateInfo): -1 | 0 | 1 {
  const aa = a.objectType
  const bb = b.objectType
  if (aa !== bb) {
    if (aa === 'AccountInfo') return -1
    if (bb === 'AccountInfo') return 1
  }
  return 0
}

async function prepareUpdate(
  updateInfo: UpdateInfo,
  objCache: Map<string, LogObject | '404'>,
  server: ServerSession,
  userId: number,
  timeout: number,
): Promise<PreparedUpdate> {
  const { objectUri, objectType, objectUpdateId, deleted } = updateInfo
  if (deleted) {
    return new PreparedUpdate(() => reviseLogObjectRecord(null, updateInfo))
  }
  const existingRecord = await getLogObjectRecord(objectType, objectUri)
  if (existingRecord && (existingRecord.latestUpdateId ?? MAX_INT64) >= objectUpdateId) {
    return new PreparedUpdate(() => Promise.resolve())
  }
  // Sometimes we can obtain the object from the cache, or reconstruct
  // the current version by updating the existing version with the
  // data received from the log entry. In such cases we spare a
  // needless network request.
  let obj: LogObject
  try {
    const cached = objCache.get(objectUri); if (cached === '404') throw '404'
    obj = cached
      ?? tryToReconstructLogObject(updateInfo, existingRecord)
      ?? makeLogObject(await server.get(objectUri, { timeout }))
  } catch (e: unknown) {
    if ((e instanceof HttpError && e.status === 404) || (e === '404')) {
      objCache.set(objectUri, '404')
      return new PreparedUpdate(() => reviseLogObjectRecord(null, updateInfo))
    } else throw e
  }
  assert(obj.type === objectType)
  objCache.set(objectUri, obj)

  return await fetchRelatedData(obj, existingRecord, updateInfo, objCache, server, userId, timeout)
}

async function fetchRelatedData(
  obj: LogObject,
  existingRecord: LogObjectRecord | undefined,
  updateInfo: UpdateInfo,
  objCache: Map<string, LogObject | '404'>,
  server: ServerSession,
  userId: number,
  timeout: number,
): Promise<PreparedUpdate> {
  switch (obj.type) {
    case 'Account': {
      const accountRecord: AccountRecord = splitIntoRecords(userId, obj).accountRecord
      const { info, display, knowledge, exchange, ledger, config } = obj
      const relatedObjects = [info, display, knowledge, exchange, ledger, config]
      for (const relatedObject of relatedObjects) {
        objCache.set(relatedObject.uri, relatedObject)
      }
      const relatedUpdates = relatedObjects.map(relatedObject => {
        assert(relatedObject.account.uri === obj.uri)
        return {
          objectUri: relatedObject.uri,
          objectType: relatedObject.type,
          objectUpdateId: relatedObject.latestUpdateId,
          deleted: false,
          addedAt: relatedObject.latestUpdateAt,
        }
      })
      return new PreparedUpdate(() => reviseLogObjectRecord(accountRecord, updateInfo), relatedUpdates)
    }

    case 'AccountLedger': {
      const accountLedgerRecord: AccountLedgerRecord = { ...obj, userId }
      const existingAccountLedgerRecord = existingRecord as AccountLedgerRecord | undefined
      const latestEntryId = (existingAccountLedgerRecord ?? accountLedgerRecord).nextEntryId - 1n
      const newLedgerEntries = await fetchNewLedgerEntries(
        server, accountLedgerRecord.entries.first, accountLedgerRecord.nextEntryId, latestEntryId, { timeout })
      const relatedUpdates: UpdateInfo[] = newLedgerEntries
        .filter(entry => entry.transfer !== undefined)
        .map(entry => {
          assert(entry.ledger.uri === obj.uri)
          return {
            objectUri: entry.transfer!.uri,
            objectType: 'CommittedTransfer',
            objectUpdateId: MAX_INT64,
            deleted: false,
            addedAt: accountLedgerRecord.latestUpdateAt,  // could be anything (will be ignored)
          }
        })
      return new PreparedUpdate(async () => {
        await reviseLogObjectRecord(accountLedgerRecord, updateInfo)
        for (const ledgerEntry of newLedgerEntries) {
          assert(ledgerEntry.entryId > 0n)
          const entryIdString = getEntryIdString(ledgerEntry.entryId)
          await storeLedgerEntryRecord({ ...ledgerEntry, userId, entryIdString })
        }
      }, relatedUpdates)
    }

    case 'Transfer': {
      const transfer: TransferV0 = obj
      return new PreparedUpdate(() => storeObject(userId, transfer))
    }

    case 'Creditor':
    case 'PinInfo':
    case 'AccountConfig':
    case 'AccountDisplay':
    case 'AccountKnowledge':
    case 'AccountExchange':
    case 'AccountInfo':
    case 'CommittedTransfer': {
      const record: CreditorRecord | PinInfoRecord | AccountObjectRecord | CommittedTransferRecord = { ...obj, userId }
      return new PreparedUpdate(() => reviseLogObjectRecord(record, updateInfo))
    }

    default:
      throw new Error('unknown object type')  // This must never happen.
  }
}

function tryToReconstructLogObject(updateInfo: UpdateInfo, record?: LogObjectRecord): LogObject | undefined {
  const { objectUpdateId, data, addedAt } = updateInfo
  let patchedObject: AccountLedgerV0 | TransferV0 | undefined

  if (record !== undefined && data !== undefined) {
    switch (record.type) {
      case 'AccountLedger':
        assert(typeof data.principal === 'bigint')
        assert(typeof data.nextEntryId === 'bigint')
        assert(typeof data.firstPage === 'string')
        patchedObject = {
          ...record,
          entries: {
            ...record.entries,
            first: new URL(data.firstPage, record.uri).href,
          },
          principal: data.principal,
          nextEntryId: data.nextEntryId,
          latestUpdateId: objectUpdateId,
          latestUpdateAt: addedAt,
        } as AccountLedgerRecord
        delete (patchedObject as any).userId
        break

      case 'Transfer':
        patchedObject = {
          ...record,
          latestUpdateId: objectUpdateId,
          latestUpdateAt: addedAt,
        } as TransferRecord
        if (data.finalizedAt !== undefined) {
          assert(typeof data.finalizedAt === 'string')
          const hasError = data.errorCode !== undefined
          let result: TransferResultV0 = {
            type: 'TransferResult',
            finalizedAt: data.finalizedAt,
            committedAmount: hasError ? 0n : patchedObject.amount
          }
          if (hasError) {
            assert(typeof data.errorCode === 'string')
            result.error = {
              type: 'TransferError',
              errorCode: data.errorCode,
            }
          }
          patchedObject.result = result
        }
        delete (patchedObject as any).userId
        break
    }
  }
  return patchedObject
}

async function* iterTransfersToLoad(server: ServerSession, transfersListUri: string): AsyncIterable<TransferV0> {
  let urisToFetch: string[] = []
  for await (const { uri: transferUri } of iterTransfersList(server, transfersListUri)) {
    const transferRecord = await getTransferRecord(transferUri)
    const isConcludedTransfer = transferRecord && (transferRecord.result || transferRecord.aborted)
    if (!isConcludedTransfer) {
      urisToFetch.push(transferUri)
    } else if (!transferRecord.aborted && transferRecord.result?.committedAmount === 0n) {
      // At this point we know that the transfer is unsuccessful, but
      // has not been aborted yet. We must include it in the transfers
      // to load, to ensure that an abort transfer action will be
      // created for this transfer. Note that we return a
      // `TransferRecord` instead of `TransferV0` here, but this is
      // OK, because the extra properties will be ignored (not saved)
      // by the `db.storeTransfer` method.
      yield transferRecord
    }
    // Request the transfers from the server in parallel, up to 20 at once.
    if (urisToFetch.length >= 20) {
      yield* await fetchTransfers(server, urisToFetch)
      urisToFetch = []
    }
  }
  yield* await fetchTransfers(server, urisToFetch)
}

async function reviseLogObjectRecord(objectRecord: LogObjectRecord | null, updateInfo?: UpdateInfo): Promise<void> {
  assert(objectRecord || updateInfo)
  const objectUri = objectRecord ? objectRecord.uri : updateInfo!.objectUri
  const objectType = objectRecord ? objectRecord.type : updateInfo!.objectType
  const objectUpdateId = objectRecord ? (objectRecord.latestUpdateId ?? MAX_INT64) : updateInfo!.objectUpdateId

  assert(!updateInfo || updateInfo.objectUri === objectUri)
  assert(!updateInfo || updateInfo.objectType === objectType)
  assert(!updateInfo || updateInfo.objectUpdateId <= objectUpdateId,
    'The version of the object received from the server is older that the version ' +
    'promised by in log entry. Normally this should never happen. A probable ' +
    'reason for this is having misconfigured HTTP caches somewhere.',
  )
  await db.transaction('rw', db.allTables, async (): Promise<void> => {
    const existingRecord = await getLogObjectRecord(objectType, objectUri)
    const alreadyUpToDate = existingRecord && (existingRecord.latestUpdateId ?? MAX_INT64) >= objectUpdateId
    if (!alreadyUpToDate) {
      if (objectRecord) {
        await storeLogObjectRecord(objectRecord, existingRecord)
      } else {
        await deleteLogObjectRecord(objectUri, objectType, objectUpdateId)
      }
    }
  })
}

async function getLogObjectRecord(objectType: LogObjectType, objectUri: string): Promise<LogObjectRecord | undefined> {
  switch (objectType) {
    case 'Creditor':
    case 'PinInfo':
      return await db.walletObjects.get(objectUri)

    case 'CommittedTransfer':
      return await db.committedTransfers.get(objectUri)

    case 'Transfer':
      return await db.transfers.get({ uri: objectUri })

    case 'AccountDisplay':
    case 'AccountKnowledge':
    case 'AccountExchange':
    case 'AccountLedger':
    case 'AccountConfig':
    case 'AccountInfo':
      return await db.accountObjects.get(objectUri)

    case 'Account':
      return await db.accounts.get(objectUri)

    default:
      throw new Error('unknown object type')
  }
}

async function deleteLogObjectRecord(
  objectUri: string,
  objectType: LogObjectType,
  objectUpdateId: bigint,
): Promise<void> {
  switch (objectType) {
    case 'Creditor':
    case 'PinInfo':
      throw new Error(
        `An attempt to delete a ${objectType} via the log stream has been detected. Wallet ` +
        `objects are singletons that must not be deleted via the log stream. A probable ` +
        `reason for this is having misconfigured HTTP caches somewhere.`
      )

    case 'CommittedTransfer':
      console.warn(
        `An attempt to delete a ${objectType} via the log stream has been ignored. Committed ` +
        `transfers are immutable, and normally will not be deleted. Nevertheless, under ` +
        `some very unlikely conditions (for example, being garbage collected on the server, ` +
        `before the corresponding log entry has been processed), this could happen.`
      )
      break

    case 'Transfer':
      await registerTranferDeletion(objectUri)
      break

    case 'AccountKnowledge':
    case 'AccountInfo':
    case 'AccountConfig':
    case 'AccountDisplay':
    case 'AccountExchange':
    case 'AccountLedger':
      await deleteAccountObject(objectUri)
      postAccountsMapMessage({ deleted: true, objectUri, objectType, objectUpdateId })
      break

    case 'Account':
      await deleteAccount(objectUri)
      postAccountsMapMessage({ deleted: true, objectUri, objectType, objectUpdateId })
      break

    default:
      throw new Error('unknown object type')  // This must never happen.
  }
}

async function storeLogObjectRecord(record: LogObjectRecord, existingRecord?: LogObjectRecord): Promise<void> {
  switch (record.type) {
    case 'Creditor':
    case 'PinInfo':
      assert(existingRecord)
      assert(existingRecord.userId === record.userId)
      assert(existingRecord.type === record.type)
      assert(existingRecord.wallet.uri === record.wallet.uri)
      await db.walletObjects.put(record)
      break

    case 'CommittedTransfer':
      if (existingRecord) {
        assert(existingRecord.type === record.type)
        assert(existingRecord.userId === record.userId)
        assert(existingRecord.account.uri === record.account.uri)
        assert(existingRecord.committedAt === record.committedAt)
        assert(existingRecord.acquiredAmount === record.acquiredAmount)
        assert(existingRecord.sender.uri === record.sender.uri)
        assert(existingRecord.recipient.uri === record.recipient.uri)
        assert(existingRecord.noteFormat === record.noteFormat)
        assert(existingRecord.note === record.note)
        assert(existingRecord.rationale === record.rationale)
      }
      await storeCommittedTransferRecord(record)
      break

    case 'Transfer':
      await storeTransfer(record.userId, record)
      break

    case 'AccountKnowledge':
      await storeAccountKnowledgeRecord(record)
      postAccountsMapMessage({ object: record, deleted: false })
      break

    case 'AccountInfo':
      await storeAccountInfoRecord(record)
      postAccountsMapMessage({ deleted: false, object: record })
      break

    case 'AccountDisplay':
      if (existingRecord) {
        assert(existingRecord.type === record.type)
        assert(existingRecord.userId === record.userId)
        assert(existingRecord.account.uri === record.account.uri)
      }
      await db.accountObjects.put(record)
      await verifyAccountKnowledge(record.uri)
      postAccountsMapMessage({ deleted: false, object: record })
      break

    case 'AccountConfig':
    case 'AccountExchange':
    case 'AccountLedger':
      if (existingRecord) {
        assert(existingRecord.type === record.type)
        assert(existingRecord.userId === record.userId)
        assert(existingRecord.account.uri === record.account.uri)
      }
      await db.accountObjects.put(record)
      postAccountsMapMessage({ deleted: false, object: record })
      break

    case 'Account':
      if (existingRecord) {
        assert(existingRecord.type === record.type)
        assert(existingRecord.userId === record.userId)
        assert(existingRecord.accountsList.uri === record.accountsList.uri)
        assert(existingRecord.debtor.uri === record.debtor.uri)
        assert(existingRecord.info.uri === record.info.uri)
        assert(existingRecord.display.uri === record.display.uri)
        assert(existingRecord.knowledge.uri === record.knowledge.uri)
        assert(existingRecord.exchange.uri === record.exchange.uri)
        assert(existingRecord.ledger.uri === record.ledger.uri)
        assert(existingRecord.config.uri === record.config.uri)
      }
      await db.accounts.put(record)
      await verifyAccountKnowledge(record.uri)
      postAccountsMapMessage({ deleted: false, object: record })
      break

    default:
      throw new Error('unknown object type')  // This must never happen.
  }
}
