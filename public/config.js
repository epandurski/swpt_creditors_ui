window.appConfig = {
  siteTitle: 'Swaptacular',
  findIssuersUrl: '',
  understandAutomatedExchangesUrl: '',
  exchangeFee: 0,
  baseDebtorInfoLocator: '',
  baseDebtorId: '',
  smallTradeAmount: 1200,
  serverApiEntrypoint: 'https://demo.swaptacular.org/creditors/.wallet',
  serverApiTimeout: 8000,
  oauth2: {
    authorizationUrl: 'https://demo.swaptacular.org/creditors-hydra/oauth2/auth',
    tokenUrl: 'https://demo.swaptacular.org/creditors-hydra/oauth2/token',
    clientId: 'localhost',
    redirectUrl: 'http://localhost:5000/',
  },
  transferDeletionDelaySeconds: 15 * 86400,
  debtorInfosRevisionDays: 7,
}

window.assert = function assert(condition, msg) {
  if (!condition) {
    let e = new Error(msg)
    e.name = 'AssertionError'
    throw e
  }
}

// if('serviceWorker' in navigator) {
//   navigator.serviceWorker.register('./sw.js')
// }
