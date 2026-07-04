// ../public/config.js makes this globally available.
declare var appConfig: {
  siteTitle: string,
  findIssuersUrl: string,
  understandAutomatedExchangesUrl: string,
  exchangeFee: number,
  baseDebtorInfoLocator: string,
  baseDebtorId: string,
  smallTradeAmount: number,
  serverApiEntrypoint: string,
  serverApiTimeout: number,
  oauth2: {
    authorizationUrl: string,
    tokenUrl: string,
    clientId: string,
    redirectUrl: string,
  },
  transferDeletionDelaySeconds: number,
  debtorInfosRevisionDays: number,
}

declare function assert(condition: any, msg?: string): asserts condition
