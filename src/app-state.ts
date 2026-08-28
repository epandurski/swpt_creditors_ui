import * as msg from './messages'
import type { Writable } from 'svelte/store'
import type { Observable } from 'dexie'
import type { TaskCallback } from './update-scheduler'
import type {
  ActionRecordWithId, CreateAccountActionWithId, AccountV0, DebtorDataSource, AccountsMap,
  AckAccountInfoActionWithId, ApproveDebtorNameActionWithId, AccountRecord, AccountDisplayRecord,
  ApproveAmountDisplayActionWithId, ApprovePegActionWithId, KnownAccountData, AccountDataForDisplay,
  CommittedTransferRecord, AccountFullData, ConfigAccountActionWithId, BaseDebtorData, PegBound,
  UpdatePolicyActionWithId, PaymentRequestActionWithId, CreateTransferActionWithId,
  ExtendedLedgerEntry, CreateTransferActionStatus, TransferRecord, ExtendedTransferRecord,
  AbortTransferActionWithId
} from './operations'

import equal from 'fast-deep-equal'
import { Dexie, liveQuery } from 'dexie'
import { writable } from 'svelte/store'
import { calcSmallestDisplayableNumber } from './format-amounts'
import { generatePr0Blob } from './payment-requests'
import {
  IS_A_NEWBIE_KEY, HAS_NOT_CREATED_PEG_ACCOUNT,
  obtainUserContext, parseCoinUri, UserContext, AuthenticationError,
  IvalidPaymentData, IvalidPaymentRequest, InvalidCoinUri, DocumentFetchError, ServerSessionError,
  RecordDoesNotExist, WrongPin, ConflictingUpdate, UnprocessableEntity, CircularPegError,
  PegDisplayMismatch, ResourceNotFound, ServerSyncError, InvalidDocument, BuyingIsForbidden,
  AccountDoesNotExist, AccountCanNotMakePayments, TransferCreationTimeout, WrongTransferData,
  ForbiddenOperation
} from './operations'

type AttemptOptions = {
  alerts?: [Function, Alert | (() => void)][],
  startInteraction?: boolean,
  waitingDelay?: number,
}

export { IS_A_NEWBIE_KEY, HAS_NOT_CREATED_PEG_ACCOUNT }

export type {
  ActionRecordWithId,
  CreateAccountActionWithId,
  ApprovePegActionWithId,
  ApproveAmountDisplayActionWithId,
  ApproveDebtorNameActionWithId,
  ConfigAccountActionWithId,
  UpdatePolicyActionWithId,
  PaymentRequestActionWithId,
  CreateTransferActionWithId,
  AbortTransferActionWithId,
  CommittedTransferRecord,
  PegBound,
  AccountDataForDisplay,
  ExtendedLedgerEntry,
  CreateTransferActionStatus,
  AccountFullData,
  AccountDisplayRecord,
  TransferRecord,
  ExtendedTransferRecord,
}

export type AlertOptions = {
  continue?: () => void,
}

export type ActionManager<T> = {
  currentValue: T,
  markDirty: () => void
  save: () => Promise<void>,
  saveAndClose: () => Promise<void>,
  remove: (back?: () => void) => Promise<void>,
}

let nextAlertId = 1

export class Alert {
  readonly id: number

  constructor(public message: string, public options: AlertOptions = {}) {
    this.id = nextAlertId++
  }
}

export type Store<T> = {
  subscribe(next: (value: T) => void): (() => void)
}

export type PageModel =
  | ActionsModel
  | CreateAccountModel
  | AckAccountInfoModel
  | ApproveDebtorNameModel
  | ApproveAmountDisplayModel
  | OverrideCoinModel
  | ApprovePegModel
  | ConfigAccountModel
  | UpdatePolicyModel
  | PaymentRequestModel
  | SealedPaymentRequestModel
  | AccountsModel
  | AccountModel
  | LedgerEntryModel
  | CreateTransferModel
  | AbortTransferModel
  | TransfersModel
  | TransferModel

type BasePageModel = {
  type: string,
  reload: () => void,
  goBack?: () => void,
}

export type ActionsModel = BasePageModel & {
  type: 'ActionsModel',
  actions: Store<ActionRecordWithId[]>,
  scrollTop?: number,
  scrollLeft?: number,
}

export type CreateAccountData = {
  account: AccountV0,
  debtorData: BaseDebtorData,
  debtorDataSource: DebtorDataSource,
  hasDebtorInfo: boolean,
  unit: string,
  amountDivisor: number,
  decimalPlaces: bigint,
}

export type CreateAccountModel = BasePageModel & {
  type: 'CreateAccountModel',
  action: CreateAccountActionWithId | ApprovePegActionWithId,
  createAccountData?: CreateAccountData,
}

export type AckAccountInfoModel = BasePageModel & {
  type: 'AckAccountInfoModel',
  action: AckAccountInfoActionWithId,
  account: AccountV0,
}

export type ApproveDebtorNameModel = BasePageModel & {
  type: 'ApproveDebtorNameModel',
  action: ApproveDebtorNameActionWithId,
  accountRecord: AccountRecord,
  debtorData: BaseDebtorData,
  display: AccountDisplayRecord,
  availableAmount: bigint,
}

export type ApproveAmountDisplayModel = BasePageModel & {
  type: 'ApproveAmountDisplayModel',
  action: ApproveAmountDisplayActionWithId,
  accountRecord: AccountRecord,
  debtorData: BaseDebtorData,
  display: AccountDisplayRecord,
  availableAmount: bigint,
}

export type OverrideCoinModel = BasePageModel & {
  type: 'OverrideCoinModel',
  action: ApprovePegActionWithId,
  createAccountData: CreateAccountData,
  peggedAccountDisplay: AccountDisplayRecord,
}

export type ApprovePegModel = BasePageModel & {
  type: 'ApprovePegModel',
  action: ApprovePegActionWithId,
  pegAccountUri: string,
  pegDebtorName: string,
  peggedAccountDisplay: AccountDisplayRecord,
  exchangeLatestUpdateId: bigint,
}

export type ConfigAccountModel = BasePageModel & {
  type: 'ConfigAccountModel',
  action: ConfigAccountActionWithId,
  accountData: AccountFullData,
  backToAccount: () => void,
  nonstandardDisplay: boolean,
}

export type UpdatePolicyModel = BasePageModel & {
  type: 'UpdatePolicyModel',
  action: UpdatePolicyActionWithId,
  accountData: AccountFullData,
  pegStatus: 'UsesNoPeg' | 'UsesStandardPeg' | 'UsesNonstandardPeg' | 'IgnoresDeclaredPeg'
  backToAccount: () => void,
}

export type PaymentRequestModel = BasePageModel & {
  type: 'PaymentRequestModel',
  action: PaymentRequestActionWithId,
  accountData: AccountFullData,
  backToAccount: () => void,
  scrollTop?: number,
  scrollLeft?: number,
}

export type SealedPaymentRequestModel = Omit<PaymentRequestModel, 'type'> & {
  type: 'SealedPaymentRequestModel',
  paymentRequest: string,
  paidAmount: bigint,
  baseAmount: bigint,
}

export type AccountsModel = BasePageModel & {
  type: 'AccountsModel',
  accounts: AccountDataForDisplay[],
  unnamedAccountUris: string[],
  searchText?: string,
  scrollTop?: number,
  scrollLeft?: number,
}

export type AccountModel = BasePageModel & {
  type: 'AccountModel',
  tab: 'account' | 'coin' | 'ledger' | 'sort',
  scrollTop?: number,
  scrollLeft?: number,
  accountData: AccountFullData,
  sortRank: number,
  transfers: ExtendedLedgerEntry[],
  fetchTransfers: () => Promise<ExtendedLedgerEntry[] | undefined>,
}

export type LedgerEntryModel = BasePageModel & {
  type: 'LedgerEntryModel',
  accountData: AccountFullData,
  ledgerEntry: ExtendedLedgerEntry,
}

export type CreateTransferModel = BasePageModel & {
  type: 'CreateTransferModel',
  action: CreateTransferActionWithId,
  accountData: AccountFullData | undefined,
}

export type AbortTransferModel = BasePageModel & {
  type: 'AbortTransferModel',
  action: AbortTransferActionWithId,
  accountData: AccountFullData | undefined,
}

export type TransfersModel = BasePageModel & {
  type: 'TransfersModel',
  transfers: ExtendedTransferRecord[],
  fetchTransfers: () => Promise<ExtendedTransferRecord[]>,
  scrollTop?: number,
  scrollLeft?: number,
}

export type TransferModel = BasePageModel & {
  type: 'TransferModel',
  transfer: Store<ExtendedTransferRecord>,
  goBack: () => void,
}

export const authenticated = writable(true)

export class AppState {
  private interactionId: number = 0
  readonly successfulPinReset: Writable<boolean>
  readonly waitingInteractions: Writable<Set<number>>
  readonly alerts: Writable<Alert[]>
  readonly pageModel: Writable<PageModel>

  goBack?: () => void

  constructor(private uc: UserContext, actions: Store<ActionRecordWithId[]>) {
    this.successfulPinReset = writable(false)
    this.waitingInteractions = writable(new Set())
    this.alerts = writable([])
    this.pageModel = writable({
      type: 'ActionsModel',
      reload: () => { this.showActions() },
      actions,
    })
  }

  startInteraction(): void {
    history.pushState(++this.interactionId, '')
  }

  get accountsMap(): AccountsMap {
    return this.uc.accountsMap
  }

  async logout(): Promise<never> {
    return await this.uc.logout()
  }

  scheduleUpdate(callback?: TaskCallback): void {
    this.uc.scheduleUpdate(callback)
  }

  fetchDataFromServer(callback?: () => void): Promise<void> {
    let interactionId = this.interactionId
    const executeCallbackAfterUpdate = () => new Promise(resolve => {
      this.uc.scheduleUpdate(() => {
        if (this.interactionId === interactionId) {
          callback?.()
        }
        resolve(undefined)
      })
    })

    return this.attempt(async () => {
      interactionId = this.interactionId
      await this.uc.ensureAuthenticated()
      authenticated.set(true)
      await executeCallbackAfterUpdate()
    }, {
      alerts: [
        [AuthenticationError, () => { }],
        [ServerSessionError, new Alert(msg.NETWORK_PROBLEM)],
      ],
    })
  }

  addAlert(alert: Alert): Promise<void> {
    return this.attempt(async () => {
      this.alerts.update(arr => [...arr, alert])
    }, {
      startInteraction: false,
    })
  }

  dismissAlert(alert: Alert): Promise<void> {
    return this.attempt(async () => {
      this.alerts.update(arr => arr.filter(a => !equal(a, alert)))
      alert.options.continue?.()
    }, {
      startInteraction: false,
    })
  }

  resetPin(newPin: string): Promise<void> {
    const retry = () => dispatchEvent(new Event('pin-not-required', { cancelable: true }))

    return this.attempt(async () => {
      await this.uc.resetPin(newPin)
      this.successfulPinReset.set(true)
    }, {
      alerts: [
        [ServerSessionError, new Alert(msg.NETWORK_PROBLEM, { continue: retry })],
      ],
    })
  }

  showActions(): Promise<void> {
    return this.attempt(async () => {
      const interactionId = this.interactionId
      const actions = await createLiveQuery(() => this.uc.getActionRecords())
      if (this.interactionId === interactionId) {
        this.pageModel.set({
          type: 'ActionsModel',
          reload: () => { this.showActions() },
          actions,
        })
      }
    })
  }

  showAction(actionId: number, back?: () => void, options?: object): Promise<void> {
    return this.attempt(async () => {
      const interactionId = this.interactionId
      const action = await this.uc.getActionRecord(actionId)
      if (this.interactionId === interactionId) {
        if (action !== undefined) {
          switch (action.actionType) {
            case 'CreateAccount':
              this.showCreateAccountAction(action, back)
              break
            case 'AckAccountInfo':
              this.showAckAccountInfoAction(action, back)
              break
            case 'ApproveDebtorName':
              this.showApproveDebtorNameAction(action, back)
              break
            case 'ApproveAmountDisplay':
              this.showApproveAmountDisplayAction(action, back)
              break
            case 'ApprovePeg':
              this.showCreateAccountAction(action, back)
              break
            case 'ConfigAccount':
              this.showConfigAccountAction(action, back, options)
              break
            case 'UpdatePolicy':
              this.showUpdatePolicyAction(action, back, options)
              break
            case 'PaymentRequest':
              this.showPaymentRequestAction(action, back, options)
              break
            case 'CreateTransfer':
              this.showCreateTransferAction(action, back)
              break
            case 'AbortTransfer':
              this.showAbortTransferAction(action, back)
              break
          }
        } else {
          this.addAlert(new Alert(msg.ACTION_DOES_NOT_EXIST, { continue: () => this.showActions() }))
        }
      }
    })
  }

  createCreateAccountAction(coinUri: string): Promise<void> {
    return this.attempt(async () => {
      const interactionId = this.interactionId
      const [latestDebtorInfoUri, debtorIdentityUri] = parseCoinUri(coinUri)
      const existingAccountUri = this.accountsMap.getAccountUri(debtorIdentityUri)
      if (existingAccountUri !== undefined) {
        const data = this.accountsMap.getAccountFullData(existingAccountUri)
        if (data?.display.knownDebtor) {
          this.showAccount(existingAccountUri)
          return
        }
      }
      const actionId = await this.uc.createCreateAccountAction(latestDebtorInfoUri, debtorIdentityUri)
      if (this.interactionId === interactionId) {
        this.showAction(actionId)
      }
    }, {
      alerts: [
        [InvalidCoinUri, new Alert(msg.INVALID_SCANNED_COIN)],
      ],
    })
  }

  showCreateAccountAction(
    action: CreateAccountActionWithId | ApprovePegActionWithId,
    back?: () => void,
  ): Promise<void> {
    let interactionId: number
    const goBack = back ?? (() => { this.showActions() })
    const checkAndGoBack = () => { if (this.interactionId === interactionId) goBack() }
    const reload = () => { this.showAction(action.actionId, back) }

    const checkAndGoCreateAccount = (createAccountData: CreateAccountData | undefined) => {
      if (this.interactionId === interactionId) {
        this.pageModel.set({ type: 'CreateAccountModel', reload, goBack, action, createAccountData })
      }
    }
    const checkAndGoApprovePeg = (createAccountData: CreateAccountData, peggedAccountData: KnownAccountData) => {
      assert(action.actionType === 'ApprovePeg')
      assert(createAccountData.account.display.debtorName !== undefined)
      if (this.interactionId === interactionId) {
        this.pageModel.set({
          type: 'ApprovePegModel',
          pegAccountUri: createAccountData.account.uri,
          pegDebtorName: createAccountData.account.display.debtorName,
          peggedAccountDisplay: peggedAccountData.display,
          exchangeLatestUpdateId: peggedAccountData.exchange.latestUpdateId,
          reload,
          goBack,
          action,
        })
      }
    }
    const checkAndGoOverrideCoin = (createAccountData: CreateAccountData, peggedAccountData: KnownAccountData) => {
      assert(action.actionType === 'ApprovePeg')
      if (this.interactionId === interactionId) {
        this.pageModel.set({
          type: 'OverrideCoinModel',
          peggedAccountDisplay: peggedAccountData.display,
          reload,
          goBack,
          action,
          createAccountData,
        })
      }
    }
    const getUris = () => action.actionType === 'CreateAccount' ? action : {
      latestDebtorInfoUri: action.peg.latestDebtorInfo.uri,
      debtorIdentityUri: action.peg.debtorIdentity.uri,
    }
    const obtainCreateAccountData = async (): Promise<CreateAccountData> => {
      const { latestDebtorInfoUri, debtorIdentityUri } = getUris()
      const account = await this.uc.ensureAccountExists(debtorIdentityUri)
      assert(account.debtor.uri === debtorIdentityUri)
      const { debtorData, debtorDataSource, hasDebtorInfo } = action.accountCreationState
        ?? await this.uc.obtainBaseDebtorData(account, latestDebtorInfoUri)
      if (
        action.actionType === 'CreateAccount' &&
        debtorDataSource === 'uri' &&
        debtorData.latestDebtorInfo.uri !== latestDebtorInfoUri
      ) {
        throw new InvalidDocument('obsolete debtor info URI')
      }
      const useDisplay = account.display.debtorName !== undefined
      return {
        account,
        debtorData,
        debtorDataSource,
        hasDebtorInfo,
        unit: useDisplay ? (account.display.unit ?? '\u00A4') : debtorData.unit,
        amountDivisor: useDisplay ? account.display.amountDivisor : debtorData.amountDivisor,
        decimalPlaces: useDisplay ? account.display.decimalPlaces : debtorData.decimalPlaces,
      }
    }
    const tryToTranslateDebtorName = (name: string): string => {
      return msg.DEBTOR_NAME_TRANSLATIONS?.[name] || name
    }
    const initializeAccountCreationState = async (data: CreateAccountData): Promise<void> => {
      const { account, debtorData, debtorDataSource, hasDebtorInfo } = data
      const useDisplay = account.display.debtorName !== undefined
      const tinyNegligibleAmount = calcSmallestDisplayableNumber(data.amountDivisor, data.decimalPlaces)
      const editedNegligibleAmount = Math.max(useDisplay ? account.config.negligibleAmount : 0, tinyNegligibleAmount)
      const editedDebtorName = tryToTranslateDebtorName(account.display.debtorName ?? debtorData.debtorName)
      const accountCreationState = {
        accountUri: data.account.uri,
        accountInitializationInProgress: false,
        confirmed: useDisplay && account.display.knownDebtor,
        debtorData,
        debtorDataSource,
        hasDebtorInfo,
        tinyNegligibleAmount,
        editedDebtorName,
        editedNegligibleAmount,
      }
      await this.uc.replaceActionRecord(action, action = { ...action, accountCreationState })
    }

    return this.attempt(async () => {
      interactionId = this.interactionId
      let createAccountData
      try {
        createAccountData = await obtainCreateAccountData()
        if (action.accountCreationState === undefined) {
          await initializeAccountCreationState(createAccountData)
        }
      } catch (e: unknown) {
        // We can ignore some of the possible errors, because the
        // action page will show an appropriate error message when
        // `createAccountData` is undefined.
        switch (true) {
          case e instanceof InvalidCoinUri:
          case e instanceof DocumentFetchError:
          case e instanceof InvalidDocument:
            assert(createAccountData === undefined)
            assert(action.accountCreationState === undefined)
            break
          default:
            throw e
        }
      }
      const debtorName = createAccountData?.account.display.debtorName
      const knownPegAccount = action.actionType === 'ApprovePeg' && debtorName !== undefined
      const crash_happened_at_the_end_of_previously_started_account_initialization = (
        action.accountCreationState?.accountInitializationInProgress === true &&
        debtorName !== undefined
      )
      if (crash_happened_at_the_end_of_previously_started_account_initialization) {
        await this.uc.finishAccountInitialization(action)
        if (!knownPegAccount) {
          await this.uc.replaceActionRecord(action, null)
          checkAndGoBack()
          return
        }
      }
      if (knownPegAccount) {
        assert(action.actionType === 'ApprovePeg')
        assert(createAccountData !== undefined)
        await this.uc.replaceActionRecord(action, action = { ...action, accountCreationState: undefined })
        const pegAccountUri = createAccountData.account.uri
        const peggedAccountData = await this.uc.validatePeggedAccount(action, pegAccountUri, action.alreadyHasApproval)
        if (!peggedAccountData) {
          await this.uc.replaceActionRecord(action, null)
          checkAndGoBack()
          return
        }
        const coinMismatch = (
          !createAccountData.hasDebtorInfo &&
          createAccountData.debtorDataSource === 'knowledge' &&
          createAccountData.debtorData.latestDebtorInfo.uri !== action.peg.latestDebtorInfo.uri
        )
        if (coinMismatch && !action.ignoreCoinMismatch) {
          checkAndGoOverrideCoin(createAccountData, peggedAccountData)
          return
        }
        checkAndGoApprovePeg(createAccountData, peggedAccountData)
      } else {
        checkAndGoCreateAccount(createAccountData)
      }
    }, {
      // NOTE: After the alert has been acknowledged, we want to be
      // certain that the user will continue to a screen which does
      // not require network connectivity to be shown correctly. The
      // current screen might not be such place. For example, when the
      // user presses the "reload" button, while reviewing a "create
      // account action".
      alerts: [
        [ServerSessionError, new Alert(msg.NETWORK_PROBLEM, { continue: checkAndGoBack })],
        [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
      ],
    })
  }

  approveAccountCreationAction(
    actionManager: ActionManager<CreateAccountActionWithId | ApprovePegActionWithId>,
    data: CreateAccountData,
    pin: string,
    knownDebtor: boolean,
    back?: () => void,
  ): Promise<void> {
    let interactionId: number
    const goBack = back ?? (() => { this.showActions() })
    const checkAndGoBack = () => { if (this.interactionId === interactionId) goBack() }
    const saveActionPromise = actionManager.save()
    let action = actionManager.currentValue

    return this.attempt(async () => {
      assert(action.accountCreationState !== undefined)
      interactionId = this.interactionId
      await saveActionPromise
      const isNewAccount = data.account.display.debtorName === undefined
      const crash_happened_at_the_end_of_previously_started_account_initialization = (
        action.accountCreationState.accountInitializationInProgress &&
        !isNewAccount
      )
      if (crash_happened_at_the_end_of_previously_started_account_initialization) {
        await this.uc.finishAccountInitialization(action)
      } else if (isNewAccount) {
        await this.uc.initializeNewAccount(action, data.account, knownDebtor, pin)
      } else {
        await this.uc.confirmInitializedAccount(action, data.account, pin, knownDebtor)
      }
      if (action.actionType === 'CreateAccount') {
        await this.uc.replaceActionRecord(action, null)
        if (this.interactionId === interactionId) {
          this.showAccount(data.account.uri)
        }
      } else {
        // The action type is `ApprovePeg`. The peg account creation
        // was only the first stage of the action, now the user should
        // continue with the approval of the peg.
        if (this.interactionId === interactionId) {
          this.showAction(action.actionId, back)
        }
      }
    }, {
      alerts: [
        [ServerSessionError, new Alert(msg.NETWORK_PROBLEM, { continue: checkAndGoBack })],
        [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
        [ConflictingUpdate, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
        [ResourceNotFound, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
        [WrongPin, new Alert(msg.WRONG_PIN, { continue: checkAndGoBack })],
        [UnprocessableEntity, new Alert(msg.WRONG_PIN, { continue: checkAndGoBack })],
      ],
    })
  }

  showAckAccountInfoAction(action: AckAccountInfoActionWithId, back?: () => void): Promise<void> {
    let interactionId: number
    let account: AccountV0 | undefined
    const goBack = back ?? (() => { this.showActions() })
    const checkAndGoBack = () => { if (this.interactionId === interactionId) goBack() }

    return this.attempt(async () => {
      interactionId = this.interactionId
      account = await this.uc.getAccount(action.accountUri)
      if (
        account &&
        account.display.debtorName !== undefined &&
        account.knowledge.latestUpdateId === action.knowledgeUpdateId
      ) {
        if (this.interactionId === interactionId) {
          this.pageModel.set({
            type: 'AckAccountInfoModel',
            reload: () => { this.showAction(action.actionId, back) },
            goBack,
            action,
            account,
          })
        }
      } else {
        await this.uc.replaceActionRecord(action, null)
        checkAndGoBack()
      }
    }, {
      alerts: [
        [ServerSessionError, new Alert(msg.NETWORK_PROBLEM, { continue: checkAndGoBack })],
        [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
      ],
    })
  }

  acknowlegeAckAccountInfoAction(
    action: AckAccountInfoActionWithId,
    account: AccountV0,
    pinForPegRemoval: string | undefined,
    back?: () => void,
  ): Promise<void> {
    let interactionId: number
    const goBack = back ?? (() => { this.showActions() })
    const checkAndGoBack = () => { if (this.interactionId === interactionId) goBack() }

    return this.attempt(async () => {
      interactionId = this.interactionId
      if (pinForPegRemoval !== undefined) {
        await this.uc.removePeg(account.exchange, pinForPegRemoval)
      }
      await this.uc.replaceActionRecord(action, action = { ...action, acknowledged: true })
      await this.uc.updateAccountKnowledge(action, account)
      assert(await this.uc.getActionRecord(action.actionId) === undefined)
      if (this.interactionId === interactionId) {
        this.showActions()
      }
    }, {
      alerts: [
        [ServerSessionError, new Alert(msg.NETWORK_PROBLEM, { continue: checkAndGoBack })],
        [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
        [ConflictingUpdate, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
        [ResourceNotFound, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
        [WrongPin, new Alert(msg.WRONG_PIN, { continue: checkAndGoBack })],
        [UnprocessableEntity, new Alert(msg.WRONG_PIN, { continue: checkAndGoBack })],
      ],
    })
  }

  showApproveDebtorNameAction(action: ApproveDebtorNameActionWithId, back?: () => void): Promise<void> {
    let interactionId: number
    const goBack = back ?? (() => { this.showActions() })
    const checkAndGoBack = () => { if (this.interactionId === interactionId) goBack() }

    return this.attempt(async () => {
      interactionId = this.interactionId
      const data = await this.uc.getKnownAccountData(action.accountUri)
      if (
        data &&
        data.debtorData.debtorName === action.debtorName
      ) {
        if (this.interactionId === interactionId) {
          this.pageModel.set({
            type: 'ApproveDebtorNameModel',
            reload: () => { this.showAction(action.actionId, back) },
            accountRecord: data.account,
            debtorData: data.debtorData,
            display: data.display,
            availableAmount: data.ledger.principal,
            goBack,
            action,
          })
        }
      } else {
        await this.uc.replaceActionRecord(action, null)
        checkAndGoBack()
      }
    }, {
      alerts: [
        [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
      ],
    })
  }

  resolveApproveDebtorNameAction(
    actionManager: ActionManager<ApproveDebtorNameActionWithId>,
    displayLatestUpdateId: bigint,
    pin: string,
    back?: () => void,
  ): Promise<void> {
    let interactionId: number
    const goBack = back ?? (() => { this.showActions() })
    const checkAndGoBack = () => { if (this.interactionId === interactionId) goBack() }
    const saveActionPromise = actionManager.save()
    let action = actionManager.currentValue

    return this.attempt(async () => {
      interactionId = this.interactionId
      await saveActionPromise
      await this.uc.resolveApproveDebtorNameAction(action, displayLatestUpdateId, pin)
      if (this.interactionId === interactionId) {
        this.showActions()
      }
    }, {
      alerts: [
        [ServerSessionError, new Alert(msg.NETWORK_PROBLEM)],
        [WrongPin, new Alert(msg.WRONG_PIN)],
        [UnprocessableEntity, new Alert(msg.WRONG_PIN)],
        [ConflictingUpdate, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
        [ResourceNotFound, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
        [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
      ],
    })
  }

  showApproveAmountDisplayAction(action: ApproveAmountDisplayActionWithId, back?: () => void): Promise<void> {
    let interactionId: number
    const goBack = back ?? (() => { this.showActions() })
    const checkAndGoBack = () => { if (this.interactionId === interactionId) goBack() }

    const initializeActionState = async (): Promise<void> => {
      const tinyNegligibleAmount = calcSmallestDisplayableNumber(action.amountDivisor, action.decimalPlaces)
      const state = {
        approved: 'yes' as const,
        editedNegligibleAmount: tinyNegligibleAmount,
        tinyNegligibleAmount,
      }
      await this.uc.replaceActionRecord(action, action = { ...action, state })
      action.state = state
    }

    return this.attempt(async () => {
      interactionId = this.interactionId
      const data = await this.uc.getKnownAccountData(action.accountUri)
      if (
        data &&
        data.debtorData.amountDivisor === action.amountDivisor &&
        data.debtorData.decimalPlaces === action.decimalPlaces &&
        data.debtorData.unit === action.unit &&
        !(
          action.amountDivisor === data.display.amountDivisor &&
          action.decimalPlaces === data.display.decimalPlaces &&
          action.unit === data.display.unit
        )
      ) {
        if (action.state === undefined) {
          await initializeActionState()
        }
        if (this.interactionId === interactionId) {
          this.pageModel.set({
            type: 'ApproveAmountDisplayModel',
            reload: () => { this.showAction(action.actionId, back) },
            accountRecord: data.account,
            debtorData: data.debtorData,
            display: data.display,
            availableAmount: data.ledger.principal,
            goBack,
            action,
          })
        }
      } else {
        await this.uc.replaceActionRecord(action, null)
        checkAndGoBack()
      }
    }, {
      alerts: [
        [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
      ],
    })
  }

  resolveApproveAmountDisplayAction(
    actionManager: ActionManager<ApproveAmountDisplayActionWithId>,
    displayLatestUpdateId: bigint,
    pin: string,
    back?: () => void,
  ): Promise<void> {
    let interactionId: number
    const goBack = back ?? (() => { this.showActions() })
    const checkAndGoBack = () => { if (this.interactionId === interactionId) goBack() }
    const saveActionPromise = actionManager.save()
    let action = actionManager.currentValue

    return this.attempt(async () => {
      interactionId = this.interactionId
      await saveActionPromise
      await this.uc.resolveApproveAmountDisplayAction(action, displayLatestUpdateId, pin)
      if (this.interactionId === interactionId) {
        this.showActions()
      }
    }, {
      alerts: [
        [ServerSessionError, new Alert(msg.NETWORK_PROBLEM)],
        [WrongPin, new Alert(msg.WRONG_PIN)],
        [UnprocessableEntity, new Alert(msg.WRONG_PIN)],
        [ServerSyncError, new Alert(msg.SERVER_SYNC_ERROR)],
        [ConflictingUpdate, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
        [ResourceNotFound, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
        [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
      ],
    })
  }

  resolveApprovePegAction(
    actionManager: ActionManager<ApprovePegActionWithId>,
    approve: boolean,
    pegAccountUri: string,
    exchangeLatestUpdateId: bigint,
    pin: string | undefined,
    back?: () => void,
  ): Promise<void> {
    let interactionId: number
    const goBack = back ?? (() => { this.showActions() })
    const checkAndGoBack = () => { if (this.interactionId === interactionId) goBack() }
    const saveActionPromise = actionManager.save()
    let action = actionManager.currentValue

    return this.attempt(async () => {
      interactionId = this.interactionId
      await saveActionPromise
      await this.uc.resolveApprovePegAction(action, approve, pegAccountUri, exchangeLatestUpdateId, pin)
      if (this.interactionId === interactionId) {
        this.showActions()
      }
    }, {
      alerts: [
        [CircularPegError, new Alert(msg.CIRCULAR_PEG)],
        [ServerSessionError, new Alert(msg.NETWORK_PROBLEM)],
        [WrongPin, new Alert(msg.WRONG_PIN)],
        [UnprocessableEntity, new Alert(msg.WRONG_PIN)],
        [ServerSyncError, new Alert(msg.SERVER_SYNC_ERROR)],
        [ConflictingUpdate, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
        [ResourceNotFound, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
        [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
        [PegDisplayMismatch, new Alert(msg.PEG_DISPLAY_MISMATCH, { continue: checkAndGoBack })],
      ],
    })
  }

  resolveCoinConflict(
    actionManager: ActionManager<ApprovePegActionWithId>,
    replace: boolean,
    pegAccountUri: string,
    back?: () => void,
  ): Promise<void> {
    let interactionId: number
    const goBack = back ?? (() => { this.showActions() })
    const checkAndGoBack = () => { if (this.interactionId === interactionId) goBack() }
    const saveActionPromise = actionManager.save()
    let action = actionManager.currentValue

    return this.attempt(async () => {
      interactionId = this.interactionId
      await saveActionPromise
      const ackAccountInfoActionId = await this.uc.resolveCoinConflict(action, replace, pegAccountUri)
      if (this.interactionId === interactionId) {
        this.showAction(ackAccountInfoActionId ?? action.actionId)
      }
    }, {
      alerts: [
        [ServerSessionError, new Alert(msg.NETWORK_PROBLEM)],
        [DocumentFetchError, new Alert(msg.COIN_FETCH_ERROR)],
        [InvalidDocument, new Alert(msg.COIN_FETCH_ERROR)],
        [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
      ],
    })
  }

  showConfigAccountAction(
    action: ConfigAccountActionWithId,
    back?: () => void,
    options?: { backToAccount?: () => void, justCreated?: boolean },
  ): Promise<void> {
    let interactionId: number
    const showActions = () => { this.showActions() }
    const goBack = back ?? showActions
    const backToAccount = options?.backToAccount ?? showActions
    const justCreated = options?.justCreated ?? false
    const checkAndGoBack = () => { if (this.interactionId === interactionId) goBack() }

    const detectNonstandardAmountDisplay = async (accountData: AccountFullData) => {
      const { amountDivisor, decimalPlaces, unit } = accountData.debtorData
      const display = accountData.display
      let nonstandard = !(
        display.amountDivisor === amountDivisor &&
        display.decimalPlaces === decimalPlaces &&
        display.unit === unit
      )
      if (nonstandard) {
        // When the current amount display is nonstandard, but there
        // is a corresponding "approve amount display" action, we
        // consider this "good enough".
        const actions = await this.uc.getActionRecords()
        nonstandard = !actions.some(a => (
          a.actionType === 'ApproveAmountDisplay' &&
          a.accountUri === action.accountUri &&
          a.amountDivisor === amountDivisor &&
          a.decimalPlaces === decimalPlaces &&
          a.unit === unit
        ))
      }
      return nonstandard
    }
    const deleteAction = () => this.uc
      .replaceActionRecord(action, null)
      .then(backToAccount, showActions)

    return this.attempt(async () => {
      interactionId = this.interactionId
      const accountData = this.accountsMap.getAccountFullData(action.accountUri)
      if (accountData) {
        const nonstandardDisplay = await detectNonstandardAmountDisplay(accountData)
        if (this.interactionId === interactionId) {
          this.pageModel.set({
            type: 'ConfigAccountModel',
            reload: () => { this.showAction(action.actionId, back) },
            goBack: justCreated ? deleteAction : goBack,
            backToAccount,
            action,
            accountData,
            nonstandardDisplay,
          })
        }
      } else {
        await this.uc.replaceActionRecord(action, null)
        checkAndGoBack()
      }
    }, {
      alerts: [
        [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
      ],
    })
  }

  executeConfigAccountAction(
    actionManager: ActionManager<ConfigAccountActionWithId>,
    accountData: AccountFullData,
    pin: string,
    back?: () => void,
  ): Promise<void> {
    let interactionId: number
    const goBack = back ?? (() => { this.showActions() })
    const checkAndGoBack = () => { if (this.interactionId === interactionId) goBack() }
    const checkAndShowActions = () => { if (this.interactionId === interactionId) this.showActions() }
    const saveActionPromise = actionManager.save()
    let action = actionManager.currentValue

    return this.attempt(async () => {
      interactionId = this.interactionId
      await saveActionPromise
      await this.uc.executeConfigAccountAction(
        action,
        accountData.display.latestUpdateId,
        accountData.config.latestUpdateId,
        pin,
      )
      checkAndGoBack()
    }, {
      alerts: [
        [ServerSessionError, new Alert(msg.NETWORK_PROBLEM)],
        [WrongPin, new Alert(msg.WRONG_PIN)],
        [UnprocessableEntity, new Alert(msg.WRONG_PIN)],
        [ConflictingUpdate, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndShowActions })],
        [ResourceNotFound, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndShowActions })],
        [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndShowActions })],
      ],
    })
  }

  showUpdatePolicyAction(
    action: UpdatePolicyActionWithId,
    back?: () => void,
    options?: { backToAccount?: () => void, justCreated?: boolean },
  ): Promise<void> {
    let interactionId: number
    const showActions = () => { this.showActions() }
    const goBack = back ?? showActions
    const backToAccount = options?.backToAccount ?? showActions
    const justCreated = options?.justCreated ?? false
    const checkAndGoBack = () => { if (this.interactionId === interactionId) goBack() }

    const detectPegStatus = async (accountData: AccountFullData) => {
      const standardPeg = accountData.debtorData.peg
      const usedPeg = accountData.exchange.peg
      if (usedPeg) {
        // Check whether the used peg is the same as the standard peg.
        const usedPegAccountData = this.accountsMap.getAccountFullData(usedPeg.account.uri)
        if (usedPegAccountData) {
          const { display, account: { debtor } } = usedPegAccountData
          if (
            standardPeg !== undefined &&
            standardPeg.exchangeRate === usedPeg.exchangeRate &&
            standardPeg.debtorIdentity.uri === debtor.uri &&
            standardPeg.display.amountDivisor === display.amountDivisor &&
            standardPeg.display.decimalPlaces === display.decimalPlaces &&
            standardPeg.display.unit === display.unit
          ) {
            return 'UsesStandardPeg' as const
          }
        }
        return 'UsesNonstandardPeg' as const
      } else if (standardPeg) {
        return 'IgnoresDeclaredPeg' as const
      }
      return 'UsesNoPeg' as const
    }
    const deleteAction = () => this.uc
      .replaceActionRecord(action, null)
      .then(backToAccount, showActions)

    return this.attempt(async () => {
      interactionId = this.interactionId
      const accountData = this.accountsMap.getAccountFullData(action.accountUri)
      if (accountData) {
        const pegStatus = await detectPegStatus(accountData)
        if (this.interactionId === interactionId) {
          this.pageModel.set({
            type: 'UpdatePolicyModel',
            reload: () => { this.showAction(action.actionId, back) },
            goBack: justCreated ? deleteAction : goBack,
            backToAccount,
            action,
            accountData,
            pegStatus,
          })
        }
      } else {
        await this.uc.replaceActionRecord(action, null)
        checkAndGoBack()
      }
    }, {
      alerts: [
        [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
      ],
    })
  }

  executeUpdatePolicyAction(
    actionManager: ActionManager<UpdatePolicyActionWithId>,
    exchangeLatestUpdateId: bigint,
    pin: string | undefined,
    back?: () => void,
  ): Promise<void> {
    let interactionId: number
    const goBack = back ?? (() => { this.showActions() })
    const checkAndGoBack = () => { if (this.interactionId === interactionId) goBack() }
    const checkAndShowActions = () => { if (this.interactionId === interactionId) this.showActions() }
    const saveActionPromise = actionManager.save()
    let action = actionManager.currentValue

    return this.attempt(async () => {
      interactionId = this.interactionId
      await saveActionPromise
      const actionId = await this.uc.executeUpdatePolicyAction(action, exchangeLatestUpdateId, pin)
      if (actionId) {
        if (this.interactionId === interactionId) this.showAction(actionId)
      } else {
        checkAndGoBack()
      }
    }, {
      alerts: [
        [ServerSessionError, new Alert(msg.NETWORK_PROBLEM)],
        [WrongPin, new Alert(msg.WRONG_PIN)],
        [UnprocessableEntity, new Alert(msg.WRONG_PIN)],
        [BuyingIsForbidden, new Alert(msg.BUYING_IS_FORBIDDEN, { continue: checkAndShowActions })],
        [ConflictingUpdate, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndShowActions })],
        [ResourceNotFound, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndShowActions })],
        [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndShowActions })],
      ],
    })
  }

  createPaymentRequestAction(accountUri: string, backToAccount?: () => void): Promise<void> {
    return this.attempt(async () => {
      const interactionId = this.interactionId
      const actionId = await this.uc.createPaymentRequestAction(accountUri)
      if (this.interactionId === interactionId) {
        this.showAction(actionId, undefined, { backToAccount, justCreated: true })
      }
    })
  }

  showPaymentRequestAction(
    action: PaymentRequestActionWithId,
    back?: () => void,
    options?: { backToAccount?: () => void, justCreated?: boolean },
  ): Promise<void> {
    let interactionId: number
    const showActions = () => { this.showActions() }
    const goBack = back ?? showActions
    const backToAccount = options?.backToAccount ?? showActions
    const justCreated = options?.justCreated ?? false
    const checkAndGoBack = () => { if (this.interactionId === interactionId) goBack() }
    const reload = () => { this.showAction(action.actionId, back) }
    const isValidHttpUrl = (s: string): boolean => {
      let url
      try {
        url = new URL(s)
      } catch {
        return false
      }
      return url.protocol === "http:" || url.protocol === "https:"
    }
    const deleteAction = () => this.uc
      .replaceActionRecord(action, null)
      .then(backToAccount, showActions)

    return this.attempt(async () => {
      interactionId = this.interactionId
      const accountData = this.accountsMap.getAccountFullData(action.accountUri)
      if (accountData && accountData.info.identity) {
        if (action.sealedAt !== undefined) {
          const deadline = new Date(action.editedDeadline)
          const isLink = isValidHttpUrl(action.editedNote)
          let pr0Blob: Blob | undefined
          try {
            pr0Blob = generatePr0Blob({
              accountUri: accountData.info.identity.uri,
              amount: action.editedAmount || 0n,
              payeeName: action.editedPayeeName,
              payeeReference: action.payeeReference,
              deadline: deadline.getTime() ? deadline : undefined,
              description: {
                contentFormat: isLink ? '-' : '',
                content: isLink ? action.editedNote.trim() : action.editedNote,
              },
            })
          } catch (e: unknown) {
            if (e instanceof IvalidPaymentData) { /* ignore */ }
            else throw e
          }
          const paymentRequest = pr0Blob !== undefined ? await pr0Blob.text() : 'INVALID PAYMENT REQUEST'
          const paidAmount = await this.uc.getExpectedPaymentAmount(action.payeeReference)
          if (this.interactionId === interactionId) {
            this.pageModel.set({
              type: 'SealedPaymentRequestModel',
              baseAmount: action.baseAmount ?? 0n,
              reload, goBack, backToAccount, action, accountData, paymentRequest, paidAmount,
            })
          }
        } else {
          if (this.interactionId === interactionId) {
            this.pageModel.set({
              type: 'PaymentRequestModel',
              goBack: justCreated ? deleteAction : goBack,
              reload, backToAccount, action, accountData,
            })
          }
        }
      } else {
        await this.uc.replaceActionRecord(action, null)
        checkAndGoBack()
      }
    }, {
      alerts: [
        [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndGoBack })],
      ],
    })
  }

  sealPaymentRequestAction(actionManager: ActionManager<PaymentRequestActionWithId>): Promise<void> {
    let interactionId: number
    const checkAndShowActions = () => { if (this.interactionId === interactionId) this.showActions() }
    const saveActionPromise = actionManager.save()
    let action = actionManager.currentValue

    return this.attempt(async () => {
      interactionId = this.interactionId
      await saveActionPromise
      await this.uc.replaceActionRecord(action, action = { ...action, sealedAt: new Date() })
      await this.uc.setDefaultPayeeName(action.editedPayeeName)
      if (this.interactionId === interactionId) {
        this.showAction(action.actionId)
      }
    }, {
      alerts: [
        [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndShowActions })],
      ],
    })
  }

  showCreateTransferAction(action: CreateTransferActionWithId, back?: () => void): Promise<void> {
    let interactionId: number
    const goBack = back ?? (() => { this.showActions() })

    return this.attempt(async () => {
      interactionId = this.interactionId
      const accountData = this.accountsMap.getAccountFullData(action.accountUri)
      if (this.interactionId === interactionId) {
        this.pageModel.set({
          type: 'CreateTransferModel',
          reload: () => { this.showAction(action.actionId, back) },
          goBack,
          action,
          accountData,
        })
      }
    })
  }

  showAbortTransferAction(action: AbortTransferActionWithId, back?: () => void): Promise<void> {
    let interactionId: number
    const goBack = back ?? (() => { this.showActions() })

    return this.attempt(async () => {
      interactionId = this.interactionId
      const accountData = action.accountUri ? this.accountsMap.getAccountFullData(action.accountUri) : undefined
      if (this.interactionId === interactionId) {
        this.pageModel.set({
          type: 'AbortTransferModel',
          reload: () => { this.showAction(action.actionId, back) },
          goBack,
          action,
          accountData,
        })
      }
    })
  }

  dismissTransfer(action: AbortTransferActionWithId): Promise<void> {
    return this.attempt(async () => {
      const interactionId = this.interactionId
      await this.uc.dismissTransfer(action)
      if (this.interactionId === interactionId) {
        this.showActions()
      }
    })
  }

  cancelTransfer(action: AbortTransferActionWithId, onFailure: () => void): Promise<void> {
    return this.attempt(async () => {
      const interactionId = this.interactionId
      const canceled = await this.uc.cancelTransfer(action)
      if (canceled) {
        await this.uc.dismissTransfer(action)
      }
      if (this.interactionId === interactionId) {
        if (canceled) {
          this.showActions()
        } else {
          onFailure()
        }
      }
    }, {
      alerts: [
        [ServerSessionError, new Alert(msg.NETWORK_PROBLEM)],
      ],
    })
  }

  async retryTransfer(transferRecord: TransferRecord): Promise<void>
  async retryTransfer(abortTransferAction: AbortTransferActionWithId): Promise<void>
  async retryTransfer(param: TransferRecord | AbortTransferActionWithId): Promise<void> {
    return this.attempt(async () => {
      const interactionId = this.interactionId
      const createTransferAction = await this.uc.retryTransfer(param as any)
      if (this.interactionId === interactionId) {
        this.showAction(createTransferAction.actionId)
      }
    }, {
      alerts: [
        [IvalidPaymentData, new Alert(msg.INVALID_PAYMENT_REQUEST)],
        [AccountDoesNotExist, new Alert(msg.ACCOUNT_DOES_NOT_EXIST)],
        [AccountCanNotMakePayments, new Alert(msg.ACCOUNT_CAN_NOT_MAKE_PAYMENTS)],
      ],
    })
  }

  showAccounts(): Promise<void> {
    return this.attempt(async () => {
      const interactionId = this.interactionId
      const accounts = await this.uc.getAccountsDataForDisplay()
      const unnamedAccountUris = this.accountsMap.getUnnamedAccountUris()
      if (this.interactionId === interactionId) {
        this.pageModel.set({
          type: 'AccountsModel',
          reload: () => { this.showAccounts() },
          goBack: () => { this.showActions() },
          accounts,
          unnamedAccountUris,
        })
      }
    })
  }

  async deleteUnnamedAccountUris(uris: string[]): Promise<void> {
    let interactionId: number
    const checkAndShowAcounts = () => { if (this.interactionId === interactionId) this.showAccounts() }

    return this.attempt(async () => {
      interactionId = this.interactionId
      this.uc.deleteUnnamedAccounts(uris)
      let resolveUpdatePromise
      const updatePromise = new Promise(resolve => { resolveUpdatePromise = resolve })
      this.uc.scheduleUpdate(resolveUpdatePromise)
      await updatePromise
      checkAndShowAcounts()
    }, {
      alerts: [
        [ServerSessionError, new Alert(msg.NETWORK_PROBLEM)],
      ],
    })
  }

  async showAccount(accountUri: string, back?: () => void): Promise<void> {
    const accountData = this.accountsMap.getAccountFullData(accountUri)
    if (accountData === undefined) {
      this.showAccounts()
      return
    }

    return this.attempt(async () => {
      const interactionId = this.interactionId
      const goBack = back ?? (() => { this.showAccounts() })
      const sortRank = await this.uc.getAccountSortPriority(accountUri)
      let [transfers, before] = await this.uc.getExtendedLedgerEntries(accountData)

      if (this.interactionId === interactionId) {
        this.pageModel.set({
          type: 'AccountModel',
          reload: () => { this.showAccount(accountUri, back) },
          fetchTransfers: async () => {
            let fetchedTransfers: ExtendedLedgerEntry[] | undefined
            await this.attempt(async () => {
              let extendedLedgerEntries: ExtendedLedgerEntry[]
              [extendedLedgerEntries, before] = await this.uc.getExtendedLedgerEntries(accountData, before)
              if (extendedLedgerEntries.length === 0) {
                // Fetch from server and retry.
                await this.uc.fetchCommittedTransfers(accountData, before);
                [extendedLedgerEntries, before] = await this.uc.getExtendedLedgerEntries(accountData, before)
              }
              fetchedTransfers = extendedLedgerEntries
            }, {
              alerts: [
                [ServerSessionError, new Alert(msg.NETWORK_PROBLEM)],
              ],
            })
            return fetchedTransfers
          },
          tab: 'account',
          transfers,
          goBack,
          accountData,
          sortRank,
        })
      }
    })
  }

  async showLedgerEntry(accountUri: string, entryId: bigint, back?: () => void): Promise<void> {
    let interactionId: number
    const goBack = back ?? (() => { this.showAccount(accountUri) })
    const checkAndGoBack = () => { if (this.interactionId === interactionId) goBack() }

    return this.attempt(async () => {
      interactionId = this.interactionId
      const accountData = this.accountsMap.getAccountFullData(accountUri)
      if (accountData === undefined) {
        checkAndGoBack()
        return
      }
      const ledgerEntry = await this.uc.getLedgerEntry(accountData.ledger.uri, entryId)
      if (ledgerEntry === undefined) {
        checkAndGoBack()
        return
      }
      let committedTransfer
      if (ledgerEntry.transfer) {
        committedTransfer = await this.uc.getCommittedTransfer(ledgerEntry.transfer.uri)
        if (committedTransfer === undefined) {
          checkAndGoBack()
          return
        }
      }
      if (this.interactionId === interactionId) {
        this.pageModel.set({
          type: 'LedgerEntryModel',
          reload: () => { this.showLedgerEntry(accountUri, entryId, back) },
          ledgerEntry: { ...ledgerEntry, transfer: committedTransfer },
          goBack,
          accountData,
        })
      }
    })
  }

  async setAccountSortPriority(uri: string, priority: number): Promise<void> {
    await this.uc.setAccountSortPriority(uri, priority)
  }

  async createConfigAccountAction(accountUri: string, back?: () => void): Promise<void> {
    return this.attempt(async () => {
      const interactionId = this.interactionId
      await this.uc.getAccount(accountUri)
      const accountData = this.accountsMap.getAccountFullData(accountUri)
      if (accountData === undefined) {
        this.showAccounts()
        return
      }
      const { action, created } = await this.uc.ensureUniqueAccountAction({
        userId: this.uc.userId,
        actionType: 'ConfigAccount',
        createdAt: new Date(),
        editedDebtorName: accountData.display.debtorName,
        editedNegligibleAmount: accountData.config.negligibleAmount,
        editedScheduledForDeletion: accountData.config.scheduledForDeletion,
        editedAllowUnsafeDeletion: accountData.config.allowUnsafeDeletion,
        approveNewDisplay: false,
        accountUri,
      })
      if (this.interactionId === interactionId) {
        this.showAction(action.actionId, undefined, { backToAccount: back, justCreated: created })
      }
    }, {
      alerts: [
        [ServerSessionError, new Alert(msg.NETWORK_PROBLEM)],
      ],
    })
  }

  async createUpdatePolicyAction(accountUri: string, back?: () => void): Promise<void> {
    return this.attempt(async () => {
      const interactionId = this.interactionId
      await this.uc.getAccount(accountUri)
      const accountData = this.accountsMap.getAccountFullData(accountUri)
      if (accountData === undefined) {
        this.showAccounts()
        return
      }
      const { minPrincipal, maxPrincipal, policy } = accountData.exchange
      const { action, created } = await this.uc.ensureUniqueAccountAction({
        userId: this.uc.userId,
        actionType: 'UpdatePolicy',
        createdAt: new Date(),
        editedPolicy: policy,
        editedMinPrincipal: minPrincipal,
        editedMaxPrincipal: maxPrincipal,
        editedUseNonstandardPeg: true,
        editedIgnoreDeclaredPeg: true,
        editedReviseApprovedPeg: false,
        accountUri,
      })
      if (this.interactionId === interactionId) {
        this.showAction(action.actionId, undefined, { backToAccount: back, justCreated: created })
      }
    }, {
      alerts: [
        [ServerSessionError, new Alert(msg.NETWORK_PROBLEM)],
      ],
    })
  }

  initiatePayment(paymentRequestFile: Blob | Promise<Blob>): Promise<void> {
    return this.attempt(async () => {
      const interactionId = this.interactionId
      const blob = await paymentRequestFile
      const action = await this.uc.processPaymentRequest(blob)
      if (this.interactionId === interactionId) {
        this.showAction(action.actionId)
      }
    }, {
      alerts: [
        [IvalidPaymentRequest, new Alert(msg.INVALID_PAYMENT_REQUEST)],
        [IvalidPaymentData, new Alert(msg.INVALID_PAYMENT_REQUEST)],
        [AccountDoesNotExist, new Alert(msg.ACCOUNT_DOES_NOT_EXIST)],
        [AccountCanNotMakePayments, new Alert(msg.ACCOUNT_CAN_NOT_MAKE_PAYMENTS)],
      ],
    })
  }

  executeCreateTransferAction(actionManager: ActionManager<CreateTransferActionWithId>, pin: string): Promise<void> {
    let interactionId: number
    const saveActionPromise = actionManager.save()
    let action = actionManager.currentValue
    const showActions = () => { this.showActions() }
    const reloadAction = () => { this.showAction(action.actionId) }
    const checkAndShowActions = () => { if (this.interactionId === interactionId) showActions() }
    const checkAndReloadAction = () => { if (this.interactionId === interactionId) reloadAction() }

    return this.attempt(async () => {
      interactionId = this.interactionId
      await saveActionPromise
      const transferRecord = await this.uc.executeCreateTransferAction(action, pin)
      if (this.interactionId === interactionId) {
        this.showTransfer(transferRecord.uri, showActions)
      }
    }, {
      alerts: [
        [ServerSessionError, new Alert(msg.NETWORK_PROBLEM, { continue: checkAndReloadAction })],
        [ForbiddenOperation, new Alert(msg.WRONG_PIN, { continue: checkAndReloadAction })],
        [WrongTransferData, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndReloadAction })],
        [TransferCreationTimeout, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndReloadAction })],
        [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: checkAndShowActions })],
      ],
    })
  }

  showTransfers(): Promise<void> {
    return this.attempt(async () => {
      const interactionId = this.interactionId

      let before: any = Dexie.maxKey
      const fetchTransfers = async (): Promise<ExtendedTransferRecord[]> => {
        const batch = await this.uc.getTransferRecords({ before, limit: 100 })
        const n = batch.length
        before = n > 0 ? batch[n - 1].time : Number.MIN_VALUE
        return batch
      }
      const transfers = await fetchTransfers()
      if (this.interactionId === interactionId) {
        this.pageModel.set({
          type: 'TransfersModel',
          reload: () => { this.showTransfers() },
          goBack: () => { this.showActions() },
          transfers,
          fetchTransfers,
        })
      }
    })
  }

  showTransfer(transferUri: string, back?: () => void): Promise<void> {
    return this.attempt(async () => {
      const interactionId = this.interactionId
      const transfer = await createLiveQuery(() => this.uc.getExtendedTransferRecord(transferUri))
      if (this.interactionId === interactionId) {
        const goBack = back ?? (() => { this.showTransfers() })
        if (getStoreValue(transfer) !== undefined) {
          this.pageModel.set({
            type: 'TransferModel',
            reload: () => { this.showTransfer(transferUri, back) },
            goBack,
            transfer: transfer as Store<ExtendedTransferRecord>,
          })
        } else {
          this.addAlert(new Alert(msg.PAYMENT_DOES_NOT_EXIST, { continue: goBack }))
        }
      }
    })
  }

  processPaymentRequests(blobs: Array<Blob> | Array<Promise<Blob>>): Promise<void> {
    return this.attempt(async () => {
      for (const blob of blobs) {
        await this.uc.processPaymentRequest(await blob)
      }
    }, {
      alerts: [
        [IvalidPaymentRequest, new Alert(msg.INVALID_PAYMENT_REQUEST)],
        [IvalidPaymentData, new Alert(msg.INVALID_PAYMENT_REQUEST)],
        [AccountDoesNotExist, new Alert(msg.ACCOUNT_DOES_NOT_EXIST)],
        [AccountCanNotMakePayments, new Alert(msg.ACCOUNT_CAN_NOT_MAKE_PAYMENTS)],
      ],
    })
  }

  /** Create an action manager instance. The action manager queues the
   * consequent asynchronous updates of the action. This is useful in
   * forms/dialogs that may modify the action, and then trigger the
   * execution of the action.
   */
  createActionManager<T extends ActionRecordWithId>(action: T, createModifiedValue = () => action): ActionManager<T> {
    let updatePromise = Promise.resolve()
    let latestValue = action
    let isDirty = false
    let isClosed = false

    const ignoreRecordDoesNotExistErrors = (error: unknown) => {
      if (error instanceof RecordDoesNotExist) {
        console.log('A "RecordDoesNotExist" error has occured during saving.')
        return Promise.resolve()
      } else {
        return Promise.reject(error)
      }
    }
    const store = async (value: T): Promise<void> => {
      await updatePromise
      if (!equal(action, value)) {
        assert(action.actionId === value.actionId)
        assert(action.actionType === value.actionType)
        await this.uc.replaceActionRecord(action, action = value)
      }
    }
    const markDirty = (): void => {
      if (!isDirty) {
        isDirty = true
        addEventListener('beforeunload', save, { capture: true })
        setTimeout(save, 5000)
      }
    }
    const save = (): Promise<void> => {
      if (!isClosed) {
        latestValue = createModifiedValue()
        updatePromise = store(latestValue).catch(ignoreRecordDoesNotExistErrors)
        isDirty = false
      }
      removeEventListener('beforeunload', save, { capture: true })
      return updatePromise
    }
    const saveAndClose = (): Promise<void> => {
      const savePromise = save()
      isClosed = true
      return savePromise
    }
    const remove = async (back?: () => void): Promise<void> => {
      let interactionId: number
      const goBack = back ?? (() => { this.showActions() })
      const checkAndGoBack = () => { if (this.interactionId === interactionId) goBack() }
      const reloadAction = () => {
        if (this.interactionId === interactionId) {
          this.showAction(action.actionId)
        }
      }
      return this.attempt(async () => {
        interactionId = this.interactionId
        await store(latestValue)
        await this.uc.replaceActionRecord(latestValue, null)
        checkAndGoBack()
      }, {
        alerts: [
          [RecordDoesNotExist, new Alert(msg.CAN_NOT_PERFORM_ACTOIN, { continue: reloadAction })],
        ],
      })
    }

    return {
      get currentValue() { return latestValue },
      markDirty,
      save,
      saveAndClose,
      remove,
    }
  }

  /* Awaits `func()`, catching and logging thrown
   * errors. `options.alerts` determines what alert should be shown on
   * what error. `option.startInteraction` determines whether a
   * hourglass should be shown when the operation had not been
   * completed after some time. */
  private async attempt(func: () => unknown, options: AttemptOptions = {}): Promise<void> {
    const { alerts = [], startInteraction = true, waitingDelay = 250 } = options

    const addWaitingInteraction = () => {
      this.waitingInteractions.update(originalSet => {
        const updatedSet = new Set(originalSet)
        updatedSet.add(interactionId)
        return updatedSet
      })
      addedWaitingInteraction = true
    }
    const clearWaitingInteraction = () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId)
      }
      if (addedWaitingInteraction) {
        this.waitingInteractions.update(originalSet => {
          const updatedSet = new Set(originalSet)
          updatedSet.delete(interactionId)
          return updatedSet
        })
      }
    }
    const alertFromError = (error: unknown): Alert | (() => void) | undefined => {
      for (const [errorConstructor, alert] of alerts) {
        if (error instanceof errorConstructor) {
          return alert
        }
      }
      return undefined
    }

    let addedWaitingInteraction = false
    let timeoutId: any
    let interactionId: number
    if (startInteraction) {
      interactionId = ++this.interactionId
      if (waitingDelay > 0) {
        timeoutId = setTimeout(addWaitingInteraction, waitingDelay)
      } else {
        addWaitingInteraction()
      }
    } else {
      interactionId = this.interactionId
    }

    try {
      await func()
    } catch (e: unknown) {
      const alert = alertFromError(e)
      if (alert === undefined) {
        console.error(e)
        this.addAlert(new Alert(msg.UNEXPECTED_ERROR))
        throw e
      } else if (typeof alert === 'function') {
        alert()
      } else {
        this.addAlert(alert)
      }
    } finally {
      clearWaitingInteraction()
    }
  }
}

/* Returns a promise for an object that satisfies Svelte's store
 * contract. Svelte stores are required to call the `onNext` method
 * synchronously, but observables are not required to do so. This
 * function awaits for the first value on the observable to appear, so
 * that the created store can return it on subscription. */
export async function createStore<T>(observable: Observable<T>): Promise<Store<T>> {
  let onNext: any
  let onError: any
  const valuePromise = new Promise<T>((resolve, reject) => {
    onNext = resolve
    onError = reject
  })
  const subscription = observable.subscribe(onNext, onError, () => onError(new Error('no value')))
  let currentValue: T = await valuePromise
  subscription.unsubscribe()

  return {
    subscribe(next) {
      let called = false
      const callNext = (value: T) => {
        if (!(called && currentValue === value)) {
          next(currentValue = value)
          called = true
        }
      }
      const subscription = observable.subscribe(callNext, error => { console.error(error) })
      callNext(currentValue)
      return subscription.unsubscribe
    }
  }
}

export function createLiveQuery<T>(querier: () => T | Promise<T>): Promise<Store<T>> {
  return createStore(liveQuery(querier))
}

export async function createAppState(): Promise<AppState | undefined> {
  const uc = await obtainUserContext()
  if (uc) {
    const actions = await createLiveQuery(() => uc.getActionRecords())
    return new AppState(uc, actions)
  }
  return undefined
}

function getStoreValue<T>(store: Store<T>): T {
  let value: T | undefined
  const unsubscribe = store.subscribe(v => { value = v })
  unsubscribe()
  return value as T
}
