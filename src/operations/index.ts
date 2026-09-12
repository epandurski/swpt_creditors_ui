import type {
  PinInfo, Account, DebtorIdentity, CommittedTransfer, Transfer, Error as WebApiError
} from './server'
import type {
  WalletRecordWithId, ActionRecordWithId, TaskRecordWithId, ListQueryOptions, CreateTransferActionWithId,
  CreateAccountActionWithId, AckAccountInfoActionWithId, DebtorDataSource, AccountDisplayRecord,
  AccountKnowledgeRecord, AccountLedgerRecord, ApproveDebtorNameActionWithId, ApproveAmountDisplayActionWithId,
  AccountRecord, ApprovePegActionWithId, AccountExchangeRecord, AccountDataForDisplay,
  CommittedTransferRecord, AccountFullData, PegBound, ConfigAccountActionWithId, AccountConfigRecord,
  UpdatePolicyActionWithId, PaymentRequestActionWithId, LedgerEntryRecord, CreateTransferActionStatus,
  AccountInfoRecord, TransferRecord, ExtendedTransferRecord, ExecutionState, AbortTransferActionWithId,
  CreateTransferAction
} from './db'
import type {
  AccountV0, AccountKnowledgeV0, AccountConfigV0, AccountExchangeV0, AccountDisplayV0, CommittedTransferV0
} from './canonical-objects'
import type { UserResetMessage } from './db-sync'
import type { BaseDebtorData } from '../debtor-info'

import equal from 'fast-deep-equal'
import { v4 as uuidv4 } from 'uuid';
import { UpdateScheduler } from '../update-scheduler'
import { InvalidDocument } from '../debtor-info'
import { MIN_INT64, MAX_INT64 } from '../format-amounts'
import { getTransferStatusDetails, NETWORK_PROBLEM, PROBLEM_ON_THE_SERVER } from '../messages'
import {
  server as defaultServer, Oauth2TokenSource, ServerSession, ServerSessionError, AuthenticationError,
  HttpResponse, HttpError
} from './server'
import {
  getWalletRecord, getTasks, removeTask, getActionRecords, settleFetchDebtorInfoTask,
  createActionRecord, getActionRecord, AccountsMap, RecordDoesNotExist, replaceActionRecord,
  InvalidActionState, createApproveAction, getBaseDebtorDataFromAccoutKnowledge, reviseOutdatedDebtorInfos,
  getAccountRecord, getAccountObjectRecord, verifyAccountKnowledge, getAccountSortPriorities,
  getAccountSortPriority, setAccountSortPriority, ensureUniqueAccountAction, ensureDeleteAccountTask,
  getDefaultPayeeName, setDefaultPayeeName, getExpectedPaymentAmount, getLedgerEntries, getCommittedTransfer,
  getEntryIdString, storeLedgerEntryRecord, getLedgerEntry, getAccountRecordByDebtorUri,
  getCreateTransferActionStatus, createTransferRecord, getTransferRecord, getTransferRecords,
  getDebtorIdentityFromAccountIdentity, getExtendedTransferRecord, removeActionRecord, storeTransfer
} from './db'
import {
  getOrCreateUserId, sync, storeObject, PinNotRequired, userResetsChannel, currentWindowUuid,
  IS_A_NEWBIE_KEY, HAS_NOT_CREATED_PEG_ACCOUNT, HAS_RECEIVED_TRADE_INSTRUCTIONS
} from './db-sync'
import { makePinInfo, makeAccount, makeTransfer, makeLogObject } from './canonical-objects'
import {
  calcParallelTimeout, InvalidCoinUri, DocumentFetchError, fetchDebtorInfoDocument, obtainBaseDebtorData,
  getDataFromDebtorInfo, fetchNewLedgerEntries
} from './utils'
import {
  IvalidPaymentRequest, IvalidPaymentData, parsePaymentRequest, generatePayment0TransferNote
} from '../payment-requests'

export {
  InvalidDocument,
  InvalidActionState,
  RecordDoesNotExist,
  IvalidPaymentRequest,
  IvalidPaymentData,
  InvalidCoinUri,
  DocumentFetchError,
  AuthenticationError,
  ServerSessionError,
  IS_A_NEWBIE_KEY,
  HAS_NOT_CREATED_PEG_ACCOUNT,
  HAS_RECEIVED_TRADE_INSTRUCTIONS,
  getCreateTransferActionStatus,
  getTransferStatusDetails,
  getExpectedPaymentAmount,
}

export type UpdatableAccountObject = AccountConfigV0 | AccountKnowledgeV0 | AccountDisplayV0 | AccountExchangeV0

export type ExtendedLedgerEntry =
  & Omit<LedgerEntryRecord, 'transfer'>
  & { transfer?: CommittedTransferRecord }

export type KnownAccountData = {
  account: AccountRecord,
  knowledge: AccountKnowledgeRecord,
  display: AccountDisplayRecord,
  exchange: AccountExchangeRecord
  ledger: AccountLedgerRecord,
  info: AccountInfoRecord,
  debtorData: BaseDebtorData,
}

export type {
  ActionRecordWithId,
  AbortTransferActionWithId,
  CreateAccountActionWithId,
  AckAccountInfoActionWithId,
  ApproveDebtorNameActionWithId,
  ApproveAmountDisplayActionWithId,
  ApprovePegActionWithId,
  ConfigAccountActionWithId,
  UpdatePolicyActionWithId,
  PaymentRequestActionWithId,
  CreateTransferActionWithId,
  AccountV0,
  DebtorDataSource,
  AccountsMap,
  AccountRecord,
  AccountDisplayRecord,
  AccountConfigRecord,
  AccountDataForDisplay,
  CommittedTransferRecord,
  AccountFullData,
  PegBound,
  BaseDebtorData,
  CreateTransferActionStatus,
  TransferRecord,
  ExtendedTransferRecord,
}

export class ConflictingUpdate extends Error {
  name = 'ConflictingUpdate'
}

export class WrongPin extends Error {
  name = 'WrongPin'
}

export class UnprocessableEntity extends Error {
  name = 'UnprocessableEntity'
}

export class ResourceNotFound extends Error {
  name = 'ResourceNotFound'
}

export class CircularPegError extends Error {
  name = 'CircularPegError'
}

export class PegDisplayMismatch extends Error {
  name = 'PegDisplayMismatch'
}

export class ServerSyncError extends Error {
  name = 'ServerSyncError'
}

export class BuyingIsForbidden extends Error {
  name = 'BuyingIsForbidden'
}

export class AccountDoesNotExist extends Error {
  name = 'AccountDoesNotExist'
}

export class AccountCanNotMakePayments extends Error {
  name = 'AccountCanNotMakePayments'
}

export class TransferCreationTimeout extends Error {
  name = 'TransferCreationTimeout'
}

export class WrongTransferData extends Error {
  name = 'WrongTransferData'
}

export class ForbiddenOperation extends Error {
  name = 'ForbiddenOperation'
}

/* Splits the coin URI (scanned from the QR code) into "debtor info
 * uri" and "debtor identity URI". The caller must be prepared this
 * function to throw `InvalidCoinUri`. */
export function parseCoinUri(coinUri: string): [string, string] {
  let latestDebtorInfoUri, debtorIdentityUri
  try {
    const url = new URL(coinUri)
    const { href, hash } = url
    latestDebtorInfoUri = href.slice(0, href.lastIndexOf(hash))
    debtorIdentityUri = hash.slice(1)
  } catch {
    throw new InvalidCoinUri()
  }
  if (`${latestDebtorInfoUri}#${debtorIdentityUri}` !== coinUri) {
    throw new InvalidCoinUri()
  }
  return [latestDebtorInfoUri, debtorIdentityUri]
}

/* Logs out the user and redirects to home, never resolves. */
export async function logout(server = defaultServer): Promise<never> {
  return await server.logout()
}

/* If the user is logged in -- does nothing. Otherwise, redirects to
 * the login page, and never resolves. */
export async function login(server = defaultServer): Promise<void> {
  await server.login(async (login) => await login())
}

/* If the user is logged in -- does nothing. Otherwise, redirects to
 * the login page that request PIN reset authorization, and never
 * resolves. */
export async function authorizePinReset(): Promise<void> {
  const server = new ServerSession({
    tokenSource: new Oauth2TokenSource(true),
    onLoginAttempt: async (login) => await login()
  })
  await server.login()
}

/* Tries to update the local database, reading the latest data from
 * the server. Any network failures will be swallowed. */
export async function update(server: ServerSession, userId: number, accountsMap: AccountsMap): Promise<void> {
  try {
    await sync(server, userId)
    await reviseOutdatedDebtorInfosIfNecessary(userId, accountsMap)
    await createAccountDeletionTasksIfNecessary(userId, accountsMap)
    if (await executeReadyTasks(server, userId)) {
      await sync(server, userId)
    }
  } catch (error: unknown) {
    let event
    switch (true) {
      case error instanceof AuthenticationError:
        event = new Event('update-authentication-error', { cancelable: true })
        break
      case error instanceof ServerSessionError:
        event = new Event('update-network-error', { cancelable: true })
        break
      case error instanceof HttpError:
        event = new Event('update-http-error', { cancelable: true })
        break
      case error instanceof PinNotRequired:
        event = new Event('pin-not-required', { cancelable: true })
        break
      default:
        throw error
    }
    if (dispatchEvent(event)) {
      console.error(error)
    }
  }
}

async function updateExecutionState(action: CreateTransferActionWithId, execution: ExecutionState): Promise<void> {
  await replaceActionRecord(action, { ...action, execution })
  action.execution = execution
}

async function createAccountDeletionTasksIfNecessary(userId: number, accountsMap: AccountsMap): Promise<void> {
  for (const accountUri of accountsMap.getDeletableAccountUris()) {
    await ensureDeleteAccountTask(userId, accountUri)
  }
}

async function reviseOutdatedDebtorInfosIfNecessary(userId: number, accountsMap: AccountsMap): Promise<void> {
  const storage_key = 'creditors.latestOutdatedDebtorInfosRevisionDate'
  const storage_value = localStorage.getItem(storage_key) ?? '1970-01-01T00:00:00.000Z'
  const latestRevisionTime = new Date(storage_value).getTime()
  const intervalMilliseconds = 1000 * 86400 * appConfig.debtorInfosRevisionDays
  const now = new Date()
  if (latestRevisionTime + intervalMilliseconds < now.getTime()) {
    await reviseOutdatedDebtorInfos(userId, accountsMap)
    console.log('Created update tasks for outdated debtor infos.')
  }
  localStorage.setItem(storage_key, now.toISOString())
}

async function executeReadyTasks(server: ServerSession, userId: number): Promise<boolean> {
  let resyncIsNeeded = false

  const createTaskExecutor = (task: TaskRecordWithId): ((timeout: number) => Promise<void>) => {
    switch (task.taskType) {
      case 'DeleteTransfer':
        return async (timeout) => {
          try {
            await server.delete(task.transferUri, { timeout })
          } catch (e: unknown) {
            // Ignore 404 errors.
            if (!(e instanceof HttpError && e.status === 404)) throw e
          }
          await removeTask(task.taskId)
        }
      case 'FetchDebtorInfo':
        return async (timeout) => {
          let document
          try {
            document = await fetchDebtorInfoDocument(task.iri, timeout)
          } catch (e: unknown) {
            // Ignore network errors.
            if (!(e instanceof DocumentFetchError)) throw e
          }
          await settleFetchDebtorInfoTask(task, document)
        }
      case 'DeleteAccount':
        return async (timeout) => {
          try {
            await server.delete(task.accountUri, { timeout })
            resyncIsNeeded = true
          } catch (e: unknown) {
            // Ignore 403 and 404 errors.
            if (!(e instanceof HttpError && (e.status === 403 || e.status === 404))) throw e
          }
          await removeTask(task.taskId)
        }
      default:
        throw new Error('unknown task type')  // This must never happen.
    }
  }

  const limit = 100
  let tasks
  do {
    tasks = await getTasks(userId, new Date(), limit)
    const timeout = calcParallelTimeout(tasks.length)
    const taskExecutors = tasks.map(task => createTaskExecutor(task))
    await Promise.all(taskExecutors.map(taskExecutor => taskExecutor(timeout)))
  } while (tasks.length >= limit)

  return resyncIsNeeded
}

const MAX_COMMITTED_TRANSFERS_FETCH_COUNT = 30

export class UserContext {
  private server: ServerSession
  private updateScheduler: UpdateScheduler
  private walletRecord: WalletRecordWithId

  readonly userId: number
  readonly scheduleUpdate: UpdateScheduler['schedule']
  readonly accountsMap: AccountsMap
  readonly getActionRecords: (options?: ListQueryOptions) => Promise<ActionRecordWithId[]>
  readonly getActionRecord = getActionRecord
  readonly replaceActionRecord = replaceActionRecord
  readonly obtainBaseDebtorData = obtainBaseDebtorData
  readonly getTransferRecords: (options?: ListQueryOptions) => Promise<ExtendedTransferRecord[]>
  readonly getTransferRecord = getTransferRecord
  readonly getExtendedTransferRecord = getExtendedTransferRecord
  readonly getAccountSortPriority = getAccountSortPriority
  readonly getExpectedPaymentAmount = getExpectedPaymentAmount
  readonly getLedgerEntry = getLedgerEntry
  readonly getCommittedTransfer = getCommittedTransfer
  readonly setAccountSortPriority: (uri: string, priority: number) => Promise<void>
  readonly setDefaultPayeeName: (payeeName: string) => Promise<void>
  readonly ensureUniqueAccountAction = ensureUniqueAccountAction

  constructor(
    server: ServerSession,
    updateScheduler: UpdateScheduler,
    accountsMap: AccountsMap,
    walletRecord: WalletRecordWithId,
  ) {
    this.server = server
    this.updateScheduler = updateScheduler
    this.accountsMap = accountsMap
    this.userId = walletRecord.userId
    this.walletRecord = walletRecord
    this.scheduleUpdate = this.updateScheduler.schedule.bind(this.updateScheduler)
    this.getTransferRecords = getTransferRecords.bind(undefined, this.userId)
    this.getActionRecords = getActionRecords.bind(undefined, this.userId)
    this.setAccountSortPriority = setAccountSortPriority.bind(undefined, this.userId)
    this.setDefaultPayeeName = setDefaultPayeeName.bind(undefined, this.userId)
  }

  /* Redirects to the login page if the user is not authenticated. The
   * caller must be prepared this method to throw `ServerSessionError`
   * or `AuthenticationError`. */
  async ensureAuthenticated(): Promise<void> {
    const entrypoint = await this.server.entrypointPromise
    if (entrypoint === undefined) {
      throw new Error('undefined entrypoint')
    }
    try {
      await this.server.get(entrypoint, { attemptLogin: true })
    } catch (e: unknown) {
      if (e instanceof HttpError) throw new ServerSessionError(`unexpected status code (${e.status})`)
      else throw e
    }
  }

  /* Resets user's PIN. The caller must be prepared this method to
   * throw `ServerSessionError`. */
  async resetPin(newPin: string): Promise<void> {
    const pinInfoUri = this.walletRecord.pinInfo.uri
    try {
      let attemptsLeft = 10
      while (true) {
        const pinInfo = await this.fetchPinInfo(pinInfoUri)
        const requestBody = {
          type: 'PinInfo',
          status: 'on',
          latestUpdateId: pinInfo.latestUpdateId + 1n,
          newPin,
        }
        try {
          const response = await this.server.patch(pinInfoUri, requestBody) as HttpResponse<PinInfo>
          await storeObject(this.userId, makePinInfo(response))
        } catch (e: unknown) {
          if (e instanceof HttpError && e.status === 409 && attemptsLeft--) continue
          else throw e
        }
        break
      }

    } catch (e: unknown) {
      if (e instanceof HttpError) throw new ServerSessionError(`unexpected status code (${e.status})`)
      else throw e
    }
  }

  /* Adds a new create account action record, and returns its action
   * ID. */
  async createCreateAccountAction(latestDebtorInfoUri: string, debtorIdentityUri: string): Promise<number> {
    return await createActionRecord({
      userId: this.userId,
      actionType: 'CreateAccount',
      createdAt: new Date(),
      latestDebtorInfoUri,
      debtorIdentityUri,
    })
  }

  /* Adds a new payment request action record, and returns its action
   * ID. */
  async createPaymentRequestAction(accountUri: string): Promise<number> {
    const defaultPayeeName = await getDefaultPayeeName(this.userId)
    return await createActionRecord({
      userId: this.userId,
      actionType: 'PaymentRequest',
      createdAt: new Date(),
      accountUri,
      payeeReference: uuidv4(),
      editedAmount: undefined,
      editedPayeeName: defaultPayeeName,
      editedDeadline: '',
      editedNote: '',
    })
  }

  /* Makes an HTTP request to obtain the most recent version of the
   * account, and returns it. The caller must be prepared this method
   * to throw `ServerSessionError`. */
  async getAccount(accountUri: string): Promise<AccountV0 | undefined> {
    let response
    try {
      response = await this.server.get(accountUri, { attemptLogin: true }) as HttpResponse<Account>
    } catch (e: unknown) {
      if (e instanceof HttpError && e.status === 404) return undefined
      else throw e
    }
    const account = makeAccount(response)
    await storeObject(this.userId, account)
    return account
  }

  /* Searches the local database for a named account (`debtorName !==
   * undefined`) with the given `accountUri`. Returns the account's
   * data on success, or `undefined` on failure. */
  async getKnownAccountData(accountUri: string): Promise<KnownAccountData | undefined> {
    const account = await getAccountRecord(accountUri)
    if (account === undefined) {
      return undefined
    }
    assert(account.type === 'Account')

    const display = await getAccountObjectRecord(account.display.uri)
    if (display === undefined) {
      return undefined
    }
    assert(display.type === 'AccountDisplay')
    if (display.debtorName === undefined) {
      return undefined
    }

    const knowledge = await getAccountObjectRecord(account.knowledge.uri)
    const exchange = await getAccountObjectRecord(account.exchange.uri)
    const ledger = await getAccountObjectRecord(account.ledger.uri)
    const info = await getAccountObjectRecord(account.info.uri)
    if (!(knowledge && exchange && ledger && info)) {
      return undefined
    }
    assert(knowledge.type === 'AccountKnowledge')
    assert(exchange.type === 'AccountExchange')
    assert(ledger.type === 'AccountLedger')
    assert(info.type === 'AccountInfo')

    const debtorData = getBaseDebtorDataFromAccoutKnowledge(knowledge)
    return { account, display, knowledge, exchange, ledger, info, debtorData }
  }

  /* Changes the display name (and possibly clears `knownDebtor`) as
   * the given action states. Deletes the action on success. The
   * caller must be prepared this method to throw
   * `RecordDoesNotExist`, `ConflictingUpdate`,
   * `WrongPin`,`UnprocessableEntity`, `ResourceNotFound`,
   * `ServerSessionError`. */
  async resolveApproveDebtorNameAction(
    action: ApproveDebtorNameActionWithId,
    displayLatestUpdateId: bigint,
    pin: string,
  ): Promise<void> {
    assert(action.userId === this.userId)
    const account = await this.getAccount(action.accountUri)
    if (!(
      account &&
      account.display.debtorName !== undefined &&
      account.display.latestUpdateId === displayLatestUpdateId &&
      getBaseDebtorDataFromAccoutKnowledge(account.knowledge).debtorName === action.debtorName
    )) {
      throw new RecordDoesNotExist()
    }
    if (action.unsetKnownDebtor) {
      const exchange: AccountExchangeV0 = {
        ...account.exchange,
        policy: undefined,
        minPrincipal: MIN_INT64,
        maxPrincipal: MAX_INT64,
        latestUpdateId: account.exchange.latestUpdateId + 1n,
        pin,
      }
      await this.updateAccountObject(exchange)
    }
    const display: AccountDisplayV0 = {
      ...account.display,
      debtorName: action.editedDebtorName,
      knownDebtor: account.display.knownDebtor && !action.unsetKnownDebtor,
      latestUpdateId: displayLatestUpdateId + 1n,
      pin,
    }
    await this.updateAccountObject(display)
    await this.replaceActionRecord(action, null)
  }

  /* Changes the amount display settings as the given action
   * states. Deletes the action on success. The caller must be
   * prepared this method to throw `RecordDoesNotExist`,
   * `ConflictingUpdate`, `ResourceNotFound`,
   * `WrongPin`,`UnprocessableEntity`, `ServerSyncError`,
   * `ServerSessionError`. */
  async resolveApproveAmountDisplayAction(
    action: ApproveAmountDisplayActionWithId,
    displayLatestUpdateId: bigint,
    pin: string,
  ): Promise<void> {
    assert(action.userId === this.userId)
    assert(action.state !== undefined)
    const account = await this.getAccount(action.accountUri)
    let debtorData: BaseDebtorData
    if (!(
      action.state.approved === 'yes' &&
      account &&
      account.display.debtorName !== undefined &&
      account.display.latestUpdateId === displayLatestUpdateId &&
      (debtorData = getBaseDebtorDataFromAccoutKnowledge(account.knowledge)) &&
      debtorData.amountDivisor === action.amountDivisor &&
      debtorData.decimalPlaces === action.decimalPlaces &&
      debtorData.unit === action.unit
    )) {
      throw new RecordDoesNotExist()
    }
    await this.removeExistingPegs(action.accountUri, pin)
    const exchange: AccountExchangeV0 = {
      ...account.exchange,
      policy: undefined,
      minPrincipal: MIN_INT64,
      maxPrincipal: MAX_INT64,
      latestUpdateId: account.exchange.latestUpdateId + 1n,
      pin,
    }
    const config: AccountConfigV0 = {
      ...account.config,
      negligibleAmount: Math.max(action.state.editedNegligibleAmount, account.config.negligibleAmount),
      latestUpdateId: account.config.latestUpdateId + 1n,
      pin,
    }
    const display: AccountDisplayV0 = {
      ...account.display,
      amountDivisor: action.amountDivisor,
      decimalPlaces: action.decimalPlaces,
      unit: action.unit,
      latestUpdateId: displayLatestUpdateId + 1n,
      pin,
    }
    await this.updateAccountObject(exchange)
    await this.updateAccountObject(config)
    await this.updateAccountObject(display)
    await this.replaceActionRecord(action, null)
  }

  /* Tries to ensure that the peg described in the given action is
   * approved or disapproved, depending on the value of the `approved`
   * parameter. Deletes the action on success. The caller must be
   * prepared this method to throw `CircularPegError`,
   * `PegDisplayMismatch`, `RecordDoesNotExist`, `ConflictingUpdate`,
   * `WrongPin`,`UnprocessableEntity`, `ResourceNotFound`,
   * `ServerSyncError`, * `ServerSessionError`. */
  async resolveApprovePegAction(
    action: ApprovePegActionWithId,
    approved: boolean,
    pegAccountUri: string,
    exchangeLatestUpdateId: bigint,
    pin: string | undefined,
  ): Promise<void> {
    // When the user's PIN is not passed, we can not change the status
    // of the peg. Instead, we must verify that the  current peg status matches
    // the expected peg status (`approved`).
    const expectedApprovalStatus = pin !== undefined ? undefined : approved

    await this.sync()
    const { accountUri, peg } = action
    const peggedAccountData = await this.validatePeggedAccount(action, pegAccountUri, expectedApprovalStatus)
    if (peggedAccountData === undefined) {
      throw new RecordDoesNotExist()
    }

    if (pin !== undefined) {
      const { userId, ...exchange } = peggedAccountData.exchange  // Remove the `userId` field.
      let updatedExchange: AccountExchangeV0 = {
        ...exchange,
        peg: undefined,
        latestUpdateId: exchangeLatestUpdateId + 1n,
        pin,
      }
      if (approved) {
        if (!await this.validatePegAccount(action, pegAccountUri)) {
          // When the peg account can not be validated, chances are
          // that the user has made the wrong choice when resolving a
          // coin conflict (resolving a coin conflict sets
          // `ignoreCoinMismatch` to true). Therefore, the user should
          // be given a chance to make the correct choice.
          await this.replaceActionRecord(action, { ...action, ignoreCoinMismatch: false })
          throw new PegDisplayMismatch()
        }
        updatedExchange.peg = {
          type: 'CurrencyPeg',
          account: { uri: pegAccountUri },
          exchangeRate: peg.exchangeRate,
        }
        const bounds = this.accountsMap.followPegChain(pegAccountUri, accountUri)
        const bound = bounds[bounds.length - 1]
        if (!bound) {
          throw new RecordDoesNotExist()
        }
        if (bound.accountUri === accountUri) {
          throw new CircularPegError()
        }
      }
      await this.updateAccountObject(updatedExchange)
    }
    await this.replaceActionRecord(action, null)
  }

  /* Updates account's configuration as the given action
   * states. Deletes the action on success. The caller must be
   * prepared this method to throw `RecordDoesNotExist`,
   * `ConflictingUpdate`, `WrongPin`, `UnprocessableEntity`,
   * `ResourceNotFound`, `ServerSessionError`. */
  async executeConfigAccountAction(
    action: ConfigAccountActionWithId,
    displayLatestUpdateId: bigint,
    configLatestUpdateId: bigint,
    pin: string,
  ): Promise<void> {
    const account = await this.getAccount(action.accountUri)
    if (account && account.display.debtorName !== undefined) {
      const config: AccountConfigV0 = {
        ...account.config,
        negligibleAmount: action.editedNegligibleAmount,
        scheduledForDeletion: action.editedScheduledForDeletion,
        allowUnsafeDeletion: action.editedAllowUnsafeDeletion,
        latestUpdateId: configLatestUpdateId + 1n,
        pin,
      }
      const display: AccountDisplayV0 = {
        ...account.display,
        debtorName: action.editedDebtorName,
        latestUpdateId: displayLatestUpdateId + 1n,
        pin,
      }
      await this.updateAccountObject(config)
      await this.updateAccountObject(display)

      if (action.approveNewDisplay) {
        const debtorData = getBaseDebtorDataFromAccoutKnowledge(account.knowledge)
        await createApproveAction({
          actionType: 'ApproveAmountDisplay',
          createdAt: new Date(),
          amountDivisor: debtorData.amountDivisor,
          decimalPlaces: debtorData.decimalPlaces,
          unit: debtorData.unit,
          userId: this.userId,
          accountUri: action.accountUri,
        })
      }
      if (action.editedAllowUnsafeDeletion) {
        this.scheduleUpdate()
      }
    }
    await this.replaceActionRecord(action, null)
  }

  /* Updates account's exchange policy as the given action
   * states. Deletes the action on success. The caller must be
   * prepared this method to throw `RecordDoesNotExist`,
   * `ConflictingUpdate`, `WrongPin`, `UnprocessableEntity`,
   * `ResourceNotFound`, `ServerSessionError`,
   * `BuyingIsForbidden`. */
  async executeUpdatePolicyAction(
    action: UpdatePolicyActionWithId,
    exchangeLatestUpdateId: bigint,
    pin: string | undefined,
  ): Promise<number | undefined> {
    let approvePegActionId: number | undefined

    const calcNewPolicy = (
      oldPolicy: string | undefined,
      oldMinPrincipal: bigint,
      accountData: AccountFullData | undefined,
    ) => {
      const forbidBuying = accountData?.secureCoin !== true || accountData.config.scheduledForDeletion
      const newPolicy = action.editedPolicy
      let newMinPrincipal, newMaxPrincipal
      if (newPolicy === undefined) {
        newMinPrincipal = MIN_INT64
        newMaxPrincipal = MAX_INT64
      } else {
        newMinPrincipal = action.editedMinPrincipal
        newMaxPrincipal = action.editedMaxPrincipal
        if (forbidBuying && (oldPolicy === undefined || newMinPrincipal > oldMinPrincipal)) {
          this.scheduleUpdate()
          throw new BuyingIsForbidden()
        }
      }
      assert(MIN_INT64 <= newMinPrincipal)
      assert(newMinPrincipal <= newMaxPrincipal)
      assert(newMaxPrincipal <= MAX_INT64)
      return { newPolicy, newMinPrincipal, newMaxPrincipal }
    }

    const account = await this.getAccount(action.accountUri)
    if (account && account.display.debtorName !== undefined) {
      const accountData = this.accountsMap.getAccountFullData(action.accountUri)
      const { policy, minPrincipal, maxPrincipal } = account.exchange
      const { newPolicy, newMinPrincipal, newMaxPrincipal } = calcNewPolicy(policy, minPrincipal, accountData)
      const removeNonstandardPeg = !action.editedUseNonstandardPeg
      if (
        newPolicy !== policy ||
        newMinPrincipal !== minPrincipal ||
        newMaxPrincipal !== maxPrincipal ||
        removeNonstandardPeg
      ) {
        if (pin === undefined) {
          throw new RecordDoesNotExist()
        }
        const exchange: AccountExchangeV0 = {
          ...account.exchange,
          policy: newPolicy,
          minPrincipal: newMinPrincipal,
          maxPrincipal: newMaxPrincipal,
          latestUpdateId: exchangeLatestUpdateId + 1n,
          pin,
        }
        if (removeNonstandardPeg) {
          exchange.peg = undefined
        }
        await this.updateAccountObject(exchange)
      }
      if (action.editedReviseApprovedPeg || !action.editedIgnoreDeclaredPeg) {
        const debtorData = getBaseDebtorDataFromAccoutKnowledge(account.knowledge)
        if (debtorData.peg) {
          approvePegActionId = await createApproveAction({
            actionType: 'ApprovePeg',
            createdAt: new Date(),
            userId: this.userId,
            accountUri: action.accountUri,
            onlyTheCoinHasChanged: false,
            ignoreCoinMismatch: false,
            alreadyHasApproval: action.editedReviseApprovedPeg,
            editedApproval: action.editedReviseApprovedPeg ? true : undefined,
            peg: debtorData.peg,
          })
        }
      }
    }
    await this.replaceActionRecord(action, null)
    return approvePegActionId
  }

  /* Resolves a coin conflict arising from the given action. Deletes
   * the action on success. If `approved` is true, downloads the
   * debtor info document for the peg currency, compares it with the
   * known debtor info, and if necessary, creates a new
   * "AckAccountInfo" action. The caller must be prepared this method
   * throw `ServerSessionError`, `InvalidDocument`,
   * `DocumentFetchError`, `RecordDoesNotExist`. */
  async resolveCoinConflict(
    action: ApprovePegActionWithId,
    approved: boolean,
    pegAccountUri: string,
  ): Promise<number | undefined> {
    let ackAccountInfoActionId
    if (approved) {
      // Before we get the not-so-reliable debtor data from the coin
      // link, we make a "last chance" attempt to obtain reliable
      // debtor info directly from the server.
      await this.getAccount(pegAccountUri)

      const debtorInfo = { type: 'DebtorInfo' as const, iri: action.peg.latestDebtorInfo.uri }
      const debtorData = await getDataFromDebtorInfo(debtorInfo, action.peg.debtorIdentity.uri)
      ackAccountInfoActionId = await verifyAccountKnowledge(pegAccountUri, debtorData, true)
    }
    await this.replaceActionRecord(action, { ...action, ignoreCoinMismatch: true })
    return ackAccountInfoActionId
  }

  /* Returns the known account data for the pegged account, but only
   * when the peg declared in the given approve peg action matches the
   * peg declared by the issuer. If `expectedApprovalStatus` is
   * passed, an the current peg approval status does not match the
   * given value, `undefined` will be returned. */
  async validatePeggedAccount(
    action: ApprovePegActionWithId,
    pegAccountUri: string,
    expectedApprovalStatus?: boolean,
  ): Promise<KnownAccountData | undefined> {
    const peggedAccountData = await this.getKnownAccountData(action.accountUri)
    if (peggedAccountData) {
      const knownPeg = peggedAccountData.debtorData.peg
      const exchangePeg = peggedAccountData.exchange.peg
      const approval = (
        exchangePeg !== undefined &&
        exchangePeg.account.uri === pegAccountUri &&
        exchangePeg.exchangeRate === action.peg.exchangeRate
      )
      if (
        !equal(action.peg, knownPeg) ||
        !(expectedApprovalStatus === undefined || approval === expectedApprovalStatus)
      ) {
        return undefined
      }
    }
    return peggedAccountData
  }

  /* Creates an account with the given debtor (`debtorIdentityUri`) if
   * it does not exist already. In both cases, returns the most recent
   * version of the account. The caller must be prepared this method
   * to throw `InvalidCoinUri` or `ServerSessionError`. */
  async ensureAccountExists(debtorIdentityUri: string): Promise<AccountV0> {
    let response
    try {
      const request: DebtorIdentity = { type: 'DebtorIdentity', uri: debtorIdentityUri }
      response = await this.server.post(
        this.walletRecord.createAccount.uri,
        request,
        { attemptLogin: true },
      ) as HttpResponse<Account>
    } catch (e: unknown) {
      if (e instanceof HttpError && e.status === 422) throw new InvalidCoinUri()
      else throw e
    }
    const account = makeAccount(response)
    await storeObject(this.userId, account)
    if (response.status === 201) {
      // When a new account has been created, chances are that very soon
      // an update in the account's info will come, and the user will
      // generally be interested to see this information as soon as
      // possible. Therefore, we schedule several consecutive server
      // checks, hoping that one of them will get the update.
      this.scheduleUpdate(90)
      this.scheduleUpdate(30)
      this.scheduleUpdate(15)
    }
    return account
  }

  /* Initializes new account's knowledge, config and display
   * records. The caller must be prepared this method to throw
   * `RecordDoesNotExist`, `ConflictingUpdate`,
   * `WrongPin`,`UnprocessableEntity`, `ServerSessionError`. */
  async initializeNewAccount(
    action: CreateAccountActionWithId | ApprovePegActionWithId,
    account: AccountV0,
    knownDebtor: boolean,
    pin: string,
  ): Promise<void> {
    assert(action.userId === this.userId)
    assert(action.accountCreationState)
    assert(account.display.debtorName === undefined)

    // Start the process of account initialization. If something goes
    // wrong, we will use the `accountInitializationInProgress` flag
    // to detect the problem and try to automatically recover from the
    // crash.
    await this.setInitializationInProgressFlag(action, true)

    const debtorData = action.accountCreationState.debtorData
    const knowledge: AccountKnowledgeV0 = {
      type: account.knowledge.type,
      uri: account.knowledge.uri,
      latestUpdateAt: account.knowledge.latestUpdateAt,
      latestUpdateId: account.knowledge.latestUpdateId + 1n,
      account: account.knowledge.account,
      debtorData,
    }
    const config: AccountConfigV0 = {
      ...account.config,
      negligibleAmount: action.accountCreationState.editedNegligibleAmount,
      latestUpdateId: account.config.latestUpdateId + 1n,
      scheduledForDeletion: false,
      allowUnsafeDeletion: false,
      pin,
    }
    const display: AccountDisplayV0 = {
      ...account.display,
      debtorName: action.accountCreationState.editedDebtorName,
      decimalPlaces: debtorData.decimalPlaces,
      amountDivisor: debtorData.amountDivisor,
      unit: debtorData.unit,
      latestUpdateId: account.display.latestUpdateId + 1n,
      knownDebtor,
      pin,
    }
    await this.updateAccountObject(knowledge)
    await this.updateAccountObject(config)
    await this.updateAccountObject(display)
    await this.finishAccountInitialization(action)
  }

  /* Finalizes the initialization of a new account. (Sets the
   * `accountInitializationInProgress` field of the passed action to
   * `false`). The caller must be prepared this method to throw
   * `RecordDoesNotExist`. */
  async finishAccountInitialization(action: CreateAccountActionWithId | ApprovePegActionWithId): Promise<void> {
    assert(action.accountCreationState)
    assert(action.accountCreationState.accountInitializationInProgress)
    const peg = action.accountCreationState.debtorData.peg
    if (peg) {
      await createApproveAction({
        actionType: 'ApprovePeg',
        userId: this.userId,
        createdAt: new Date(),
        onlyTheCoinHasChanged: false,
        alreadyHasApproval: false,
        ignoreCoinMismatch: false,
        accountUri: action.accountCreationState.accountUri,
        peg,
      }, false)
    }
    await verifyAccountKnowledge(action.accountCreationState.accountUri)
    await this.setInitializationInProgressFlag(action, false)
  }

  /* Updates the display and config records of an already initialized
   * account. (Sets the `accountInitializationInProgress` field of the
   * passed action to `false`). The caller must be prepared this method
   * to throw `RecordDoesNotExist`, `ConflictingUpdate`, `WrongPin`,
   * `UnprocessableEntity`, `ServerSessionError`. */
  async confirmInitializedAccount(
    action: CreateAccountActionWithId | ApprovePegActionWithId,
    account: AccountV0,
    pin: string,
    knownDebtor: boolean,
  ): Promise<void> {
    assert(action.userId === this.userId)
    assert(action.accountCreationState)
    assert(!action.accountCreationState.accountInitializationInProgress && account.display.debtorName !== undefined)

    const display: AccountDisplayV0 = {
      ...account.display,
      knownDebtor: account.display.knownDebtor || knownDebtor,
      debtorName: action.accountCreationState.editedDebtorName,
      latestUpdateId: account.display.latestUpdateId + 1n,
      pin,
    }
    const config: AccountConfigV0 = {
      ...account.config,
      negligibleAmount: action.accountCreationState.editedNegligibleAmount,
      scheduledForDeletion: false,
      allowUnsafeDeletion: false,
      latestUpdateId: account.config.latestUpdateId + 1n,
      pin,
    }
    await this.updateAccountObject(display)
    await this.updateAccountObject(config)
    await this.setInitializationInProgressFlag(action, false)
  }

  /* Updates account's knowledge as the given action states. Deletes
   * the action on success. The caller must be prepared this method to
   * throw `ConflictingUpdate` or `ServerSessionError`. (Normally,
   * `WrongPin` and `UnprocessableEntity` should never be thrown.) */
  async updateAccountKnowledge(action: AckAccountInfoActionWithId, account: AccountV0): Promise<void> {
    assert(action.userId === this.userId)
    const oldDebtorData = getBaseDebtorDataFromAccoutKnowledge(account.knowledge, false)

    // Update the properties that the app understands and tracks,
    // but also preserve the unknown properties.
    const updatedKnowledge: AccountKnowledgeV0 = {
      ...account.knowledge,
      configError: action.configError,
      interestRateChangedAt: action.interestRateChangedAt,
      interestRate: action.interestRate,
      debtorData: {
        ...oldDebtorData,
        ...action.debtorData,
      },
      latestUpdateId: account.knowledge.latestUpdateId + 1n,
    }

    // This will automatically delete the action.
    await this.updateAccountObject(updatedKnowledge)
  }

  /* Removes account's exchange peg. The caller must be prepared this
   * method to throw `ConflictingUpdate`, `WrongPin`,
   * `UnprocessableEntity`, `ServerSessionError`. */
  async removePeg(exchange: AccountExchangeV0, pin: string, timeout?: number): Promise<void> {
    const updatedExchange: AccountExchangeV0 = {
      ...exchange,
      peg: undefined,
      latestUpdateId: exchange.latestUpdateId + 1n,
      pin,
    }
    await this.updateAccountObject(updatedExchange, { timeout, ignore404: true })
    console.log(`Removed exchange peg for account ${exchange.account.uri}`)
  }

  /* Try to delete the given account URIs. The caller must be prepared
   * this method to throw `ServerSessionError`. */
  async deleteUnnamedAccounts(accountUris: string[]): Promise<void> {
    const timeout = calcParallelTimeout(accountUris.length)
    const deleteAccount = async (accountUri: string) => {
      try {
        await this.server.delete(accountUri, { timeout, attemptLogin: true })
      } catch (e: unknown) {
        // Ignore 403 and 404 errors.
        if (!(e instanceof HttpError && (e.status === 403 || e.status === 404))) throw e
      }
    }
    await Promise.all(accountUris.map(uri => deleteAccount(uri)))
  }

  /* Reads a payment request, and adds and returns a new create
   * transfer action. The caller must be prepared this method to throw
   * `IvalidPaymentRequest`, `IvalidPaymentData`,
   * `AccountDoesNotExist`, `AccountCanNotMakePayments`. */
  async processPaymentRequest(blob: Blob): Promise<CreateTransferActionWithId> {
    const request = await parsePaymentRequest(blob)
    const knownAccountData = await this.getSenderAccountData(request.accountUri)
    const actionRecord = {
      userId: this.userId,
      actionType: 'CreateTransfer' as const,
      createdAt: new Date(),
      recipientUri: request.accountUri,
      transferUuid: uuidv4(),
      editedAmount: request.amount,
      editedDeadline: request.deadline,
      paymentInfo: {
        payeeReference: request.payeeReference,
        payeeName: request.payeeName,
        description: request.description,
      },
      noteFormat: request.amount ? 'PAYMENT0' : 'payment0',
      note: generatePayment0TransferNote(request, Number(knownAccountData.info.noteMaxBytes)),
      requestedAmount: request.amount,
      requestedDeadline: request.deadline,
      accountUri: knownAccountData.account.uri,
    }
    await createActionRecord(actionRecord)  // adds the `actionId` field
    return actionRecord as CreateTransferActionWithId
  }

  /* Tries to (re)execute the given create transfer action. If the
   * execution is successful, the given action record is deleted, and
   * a `TransferRecord` instance is returned. The caller must be
   * prepared this method to throw `ServerSessionError`,
   * `ForbiddenOperation`, `WrongTransferData`,
   * `TransferCreationTimeout`, `RecordDoesNotExist`. Note that the
   * passed `action` object will be modified according to the changes
   * occurring in the state of the action record. */
  async executeCreateTransferAction(action: CreateTransferActionWithId, pin: string): Promise<TransferRecord> {
    let transferRecord

    switch (getCreateTransferActionStatus(action)) {
      case 'Draft':
      case 'Not confirmed':
      case 'Not sent':
        const now = Date.now()
        const { startedAt = new Date(now), unresolvedRequestAt } = action.execution ?? {}
        const requestTime = Math.max(now, (unresolvedRequestAt?.getTime() ?? -Infinity) + 1)
        await updateExecutionState(action, { startedAt, unresolvedRequestAt: new Date(requestTime) })

        // When the given PIN is obviously invalid, we want to avoid
        // getting a 422 error because of this, so we report the error
        // immediately.
        if (!pin.match(/^[0-9]{4,10}$/)) {
          await updateExecutionState(action, { startedAt, unresolvedRequestAt })
          throw new ForbiddenOperation()
        }

        // The user should not be able to set a later deadline than
        // the deadline declared in the payment request. (Otherwise
        // the money could get transferred too late.)
        let deadline = action.editedDeadline
        if (deadline !== undefined) {
          const t = deadline.getTime()
          if (Number.isNaN(t) || (action.requestedDeadline !== undefined && t > action.requestedDeadline.getTime())) {
            deadline = action.requestedDeadline
          }
        }

        // It is theoretically possible this to throw an
        // `IvalidPaymentData` error, but normally, this should not happen.
        const creationRequest = {
          type: 'TransferCreationRequest' as const,
          recipient: { type: 'AccountIdentity' as const, uri: action.recipientUri },
          amount: action.editedAmount,
          transferUuid: action.transferUuid,
          noteFormat: action.noteFormat,
          note: action.note,
          options: { type: 'TransferOptions' as const, deadline: deadline?.toISOString() },
          pin,
        }

        try {
          const response = await this.server.post(
            this.walletRecord.createTransfer.uri,
            creationRequest,
            { attemptLogin: true },
          ) as HttpResponse<Transfer>
          const transfer = makeTransfer(response)
          transferRecord = await createTransferRecord(action, transfer)
        } catch (e: unknown) {
          if (e instanceof HttpError) {
            if (e.status === 422) {
              const webApiError: WebApiError = (typeof e.data === 'object' ? e.data : null) ?? {}
              await updateExecutionState(action, { startedAt, result: { ...webApiError, ok: false as const } })
              throw new WrongTransferData()
            } else {
              await updateExecutionState(action, { startedAt, unresolvedRequestAt })
              if (e.status === 403) throw new ForbiddenOperation()
              throw new ServerSessionError(`unexpected status code (${e.status})`)
            }
          } else throw e
        }
        break

      case 'Initiated':
        const transferUri: string = (action.execution?.result as any).transferUri
        transferRecord = await getTransferRecord(transferUri)
        assert(transferRecord, 'missing transfer record')
        replaceActionRecord(action, null)
        break

      case 'Failed':
        throw new WrongTransferData()

      case 'Timed out':
        throw new TransferCreationTimeout()
    }

    if (!transferRecord.result && transferRecord.checkupAt) {
      this.scheduleUpdate(new Date(transferRecord.checkupAt))
    }
    return transferRecord
  }

  /* Dismisses an unsuccessful or delayed transfer. */
  async dismissTransfer(action: AbortTransferActionWithId): Promise<TransferRecord> {
    await removeActionRecord(action.actionId)
    const transferRecord = await getTransferRecord(action.transferUri)
    assert(transferRecord, 'missing transfer record')
    return transferRecord
  }

  /* Tries to cancel a delayed transfer. Returns whether the transfer
   * was canceled. For delayed transfers, this method should be called
   * before calling `dismissTransfer`. The caller must be prepared
   * this method to throw `ServerSessionError`.*/
  async cancelTransfer(action: AbortTransferActionWithId): Promise<boolean> {
    let response
    try {
      response = await this.server.post(
        action.transferUri,
        { type: 'TransferCancelationRequest' },
        { attemptLogin: true },
      ) as HttpResponse<Transfer>
    } catch (e: unknown) {
      if (e instanceof HttpError) {
        if (e.status === 403 || e.status === 404) return false
        throw new ServerSessionError(`unexpected status code (${e.status})`)
      }
      throw e
    }
    const transfer = makeTransfer(response)
    await storeTransfer(action.userId, transfer)
    return true
  }

  /* Retries an unsuccessful transfer. The caller must be prepared
   * this method to throw `IvalidPaymentRequest`,
   * `AccountDoesNotExist`, `AccountCanNotMakePayments`. */
  async retryTransfer(transferRecord: TransferRecord): Promise<CreateTransferActionWithId>
  async retryTransfer(abortTransferAction: AbortTransferActionWithId): Promise<CreateTransferActionWithId>
  async retryTransfer(param: TransferRecord | AbortTransferActionWithId): Promise<CreateTransferActionWithId> {
    const [transferRecord, abortTransferAction] = 'actionId' in param
      ? [await getTransferRecord(param.transferUri), param]
      : [param, undefined]
    assert(transferRecord, 'missing transfer record')

    const recipientUri = transferRecord.recipient.uri
    const knownAccountData = await this.getSenderAccountData(recipientUri)
    let deadline: Date | undefined = new Date(transferRecord.options.deadline ?? '')
    if (Number.isNaN(deadline.getTime())) {
      deadline = undefined
    }
    const createTransferAction: CreateTransferAction = {
      userId: transferRecord.userId,
      actionType: 'CreateTransfer' as const,
      createdAt: new Date(),
      transferUuid: uuidv4(),
      editedAmount: transferRecord.amount,
      editedDeadline: deadline,
      paymentInfo: transferRecord.paymentInfo,
      noteFormat: transferRecord.noteFormat,
      note: transferRecord.note,
      requestedAmount: transferRecord.amount,
      requestedDeadline: deadline,
      accountUri: knownAccountData.account.uri,
      recipientUri,
    }

    if (abortTransferAction) {
      try {
        await replaceActionRecord(abortTransferAction, createTransferAction)
        return createTransferAction as CreateTransferActionWithId
      } catch (e: unknown) {
        if (e instanceof RecordDoesNotExist) assert(!await getActionRecord(abortTransferAction.actionId))
        else throw e
      }
    }
    await createActionRecord(createTransferAction)
    return createTransferAction as CreateTransferActionWithId
  }

  /* Returns the properly sorted list of configured accounts for the
   * current user. */
  async getAccountsDataForDisplay(): Promise<AccountDataForDisplay[]> {
    const priorities = await getAccountSortPriorities(this.userId)
    const prioritiesMap = new Map(priorities.map(p => [p.uri, p.priority]))
    return this.accountsMap
      .getAccountsDataForDisplay()
      .sort((a, b) => {
        // Sort by priority. If priorities are equal, sort by debtor name.
        const displayA = a.display
        const displayB = b.display
        const priorityA = prioritiesMap.get(displayA.account.uri) ?? 1
        const priorityB = prioritiesMap.get(displayB.account.uri) ?? 1
        if (priorityA > priorityB) {
          return -1
        }
        if (priorityA < priorityB) {
          return 1
        }
        const nameA = (displayA.debtorName ?? '').toLowerCase()
        const nameB = (displayB.debtorName ?? '').toLowerCase()
        return nameA > nameB ? 1 : (nameA === nameB ? 0 : -1)
      })
  }

  /* Tries to fetch unknown committed transfers for a given account
   * from the server. `before` must be the ID of the earliest known
   * ledger entry. The caller must be prepared this method to throw
   * `ServerSessionError`. */
  async fetchCommittedTransfers(
    accountData: AccountFullData,
    before: bigint,
    limit: number = MAX_COMMITTED_TRANSFERS_FETCH_COUNT,
  ): Promise<void> {
    let first = new URL(accountData.ledger.entries.first)
    first.searchParams.set('prev', before.toString())
    const stop = before - BigInt(limit) - 1n
    const ledgerEntries = await fetchNewLedgerEntries(
      this.server, first.href, before, stop > 0n ? stop : 0n, { attemptLogin: true })
    const userId = this.userId
    for (const ledgerEntry of ledgerEntries) {
      assert(ledgerEntry.entryId > 0n)
      const entryIdString = getEntryIdString(ledgerEntry.entryId)
      await storeLedgerEntryRecord({ ...ledgerEntry, userId, entryIdString })
    }
    const timeout = calcParallelTimeout(ledgerEntries.length)
    await Promise.all(ledgerEntries.map(entry => this.fetchCommittedTransfer(entry.transfer?.uri, timeout)))
  }

  /* Returns an array of sequential ledger entries (with their
   * corresponding committed transfers), plus the ledger entry ID of
   * the earliest entry in the list. If the returned list is empty,
   * the value of the passed `before` ledger entry ID will be returned
   * (it defaults to the ID of the latest ledger entry). This function
   * will not try to make any network requests. */
  async getExtendedLedgerEntries(
    accountData: AccountFullData,
    before: bigint = accountData.ledger.nextEntryId,
    limit: number = MAX_COMMITTED_TRANSFERS_FETCH_COUNT,
  ): Promise<[ExtendedLedgerEntry[], bigint]> {
    let extendedLedgerEntries = []
    const ledgerEntries = await getLedgerEntries(accountData.ledger.uri, { before, limit })
    for (const ledgerEntry of ledgerEntries) {
      const { entryId, transfer } = ledgerEntry
      if (entryId + 1n !== before) break
      let committedTransfer: CommittedTransferRecord | undefined
      if (transfer) {
        committedTransfer = await getCommittedTransfer(transfer.uri)
        if (!committedTransfer) break
      }
      extendedLedgerEntries.push({ ...ledgerEntry, transfer: committedTransfer })
      before = entryId
    }
    return [extendedLedgerEntries, before]
  }

  /* Forgets authentication credentials, and goes to the login page. */
  async logout(): Promise<never> {
    return await this.server.logout()
  }

  private async validatePegAccount(action: ApprovePegActionWithId, pegAccountUri: string): Promise<boolean> {
    const { amountDivisor, decimalPlaces, unit } = action.peg.display
    const data = await this.getKnownAccountData(pegAccountUri)
    return (
      data !== undefined &&
      action.peg.debtorIdentity.uri === data.account.debtor.uri &&
      amountDivisor === data.display.amountDivisor &&
      decimalPlaces === data.display.decimalPlaces &&
      unit === data.display.unit
    )
  }

  private async setInitializationInProgressFlag(
    action: CreateAccountActionWithId | ApprovePegActionWithId,
    value: boolean,
  ): Promise<void> {
    assert(action.accountCreationState)
    await this.replaceActionRecord(action, {
      ...action,
      accountCreationState: {
        ...action.accountCreationState,
        accountInitializationInProgress: value,
      },
    })
    action.accountCreationState.accountInitializationInProgress = value
  }

  private async removeExistingPegs(pegAccountUri: string, pin: string): Promise<void> {
    await this.sync()
    const exchanges = this.accountsMap
      .getPeggedAccountExchangeRecords(pegAccountUri)
      .map(accountExchangeRecord => {
        const { userId, ...exchange } = accountExchangeRecord
        return exchange
      })
    const timeout = calcParallelTimeout(exchanges.length)
    await Promise.all(exchanges.map(exchange => this.removePeg(exchange, pin, timeout)))
  }

  /* Updates account's config, knowledge, display, or exchange.
   * Returns the new version. May throw `ServerSessionError`,
   * `ConflictingUpdate`, `WrongPin`, `UnprocessableEntity`,
   * `ResourceNotFound`. */
  private async updateAccountObject<T extends UpdatableAccountObject>(
    obj: T,
    options: { timeout?: number, ignore404?: boolean } = {},
  ): Promise<void> {
    const { timeout, ignore404 = false } = options
    let response
    try {
      const { uri, account, latestUpdateAt, ...request } = obj
      response = await this.server.patch(uri, request, { timeout, attemptLogin: true })
    } catch (e: unknown) {
      if (e instanceof HttpError) {
        switch (e.status) {
          case 404:
            this.scheduleUpdate()
            if (ignore404) return
            throw new ResourceNotFound()
          case 409:
            this.scheduleUpdate()
            throw new ConflictingUpdate()
          case 403:
            throw new WrongPin()
          case 422:
            throw new UnprocessableEntity()
        }
      }
      throw e
    }
    const accountObject = makeLogObject(response) as T
    await storeObject(this.userId, accountObject)
  }

  private async fetchPinInfo(pinInfoUri: string): Promise<PinInfo> {
    const response = await this.server.get(pinInfoUri) as HttpResponse<PinInfo>
    return response.data
  }

  private async fetchCommittedTransfer(uri: string | undefined, timeout?: number): Promise<void> {
    if (uri !== undefined) {
      let response
      try {
        response = await this.server.get(uri, { timeout, attemptLogin: true }) as HttpResponse<CommittedTransfer>
      } catch (e: unknown) {
        if (e instanceof HttpError && e.status === 404) return  /* ignore */
        throw e
      }
      const committedTransferObject = makeLogObject(response) as CommittedTransferV0
      assert(committedTransferObject.type === 'CommittedTransfer')
      await storeObject(this.userId, committedTransferObject)
    }
  }

  private async getSenderAccountData(recipientUri: string): Promise<KnownAccountData> {
    const debtorUri = getDebtorIdentityFromAccountIdentity(recipientUri)
    if (debtorUri === undefined) {
      throw new IvalidPaymentRequest('invalid account identity')
    }
    let account, knownAccountData
    if (!(
      (account = await getAccountRecordByDebtorUri(this.userId, debtorUri)) &&
      (knownAccountData = await this.getKnownAccountData(account.uri))
    )) {
      throw new AccountDoesNotExist()
    }
    if (!knownAccountData.info.account) {
      throw new AccountCanNotMakePayments()
    }
    return knownAccountData
  }

  private async sync(): Promise<void> {
    try {
      await sync(this.server, this.userId)
    } catch (e: unknown) {
      switch (true) {
        case e instanceof AuthenticationError:
          await this.ensureAuthenticated()
          await sync(this.server, this.userId)
          break
        case e instanceof HttpError:
          throw new ServerSyncError()
        default:
          throw e
      }
    }
  }
}

/* If the user is logged in, returns an user context
 * instance. Otherise, returns `undefined`. The obtained user context
 * instance can be used to perform operations on user's behalf. */
export async function obtainUserContext(
  server = defaultServer,
  updateScheduler?: UpdateScheduler,
): Promise<UserContext | undefined> {
  let userId: number
  try {
    const entrypoint = await server.entrypointPromise
    if (entrypoint === undefined) {
      return undefined
    }
    userId = await getOrCreateUserId(server, entrypoint)
  } catch (e: unknown) {
    switch (true) {
      case e instanceof AuthenticationError:
      case e instanceof HttpError:
        console.error(e)
        alert(PROBLEM_ON_THE_SERVER)
        await server.logout()
        break
      case e instanceof ServerSessionError:
        console.error(e)
        alert(NETWORK_PROBLEM)
        await server.logout()
        break
    }
    throw e
  }

  userResetsChannel.onmessage = async (evt: MessageEvent<UserResetMessage>) => {
    if (evt.data.userId === userId && evt.data.windowUuid !== currentWindowUuid) {
      // The user's data has been reset by another app window. This
      // is likely to disturb the interaction with the UI.
      console.warn('Failed to synchronize with the server. The app is being automatically restarted.')
      location.reload()
    }
  }
  const accountsMap = new AccountsMap()
  await accountsMap.init(userId)

  return new UserContext(
    server,
    updateScheduler ?? new UpdateScheduler(update.bind(undefined, server, userId, accountsMap)),
    accountsMap,
    await getWalletRecord(userId),
  )
}
