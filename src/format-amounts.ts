export const MAX_INT64 = (1n << 63n) - 1n
export const MIN_INT64 = -MAX_INT64 - 1n

const MAX_AMOUNT = Number(MAX_INT64)
const MIN_AMOUNT_DIVISOR = 1e-99
const MAX_AMOUNT_DIVISOR = 1e99

type Display = {
  amountDivisor: number,
  decimalPlaces: bigint,
}

export function limitAmountDivisor(amountDivisor: number): number {
  assert(amountDivisor >= 0)
  if (amountDivisor <= MIN_AMOUNT_DIVISOR) return MIN_AMOUNT_DIVISOR
  if (amountDivisor >= MAX_AMOUNT_DIVISOR) return MAX_AMOUNT_DIVISOR
  return amountDivisor
}

export function calcSmallestDisplayableNumber(amountDivisor: number, decimalPlaces: number | bigint): number {
  amountDivisor = limitAmountDivisor(amountDivisor)
  return Math.pow(10, -Number(decimalPlaces)) * amountDivisor
}

export function stringToAmount(s: string | number, amountDivisor: number): bigint {
  amountDivisor = limitAmountDivisor(amountDivisor)
  const amount = BigInt(Math.round(Number(s) * amountDivisor))
  if (amount <= MIN_INT64) return MIN_INT64
  if (amount >= MAX_INT64) return MAX_INT64
  return amount
}

export function amountToString(
  value: number | bigint,
  amountDivisor: number,
  decimalPlaces: number | bigint,
  decimalSeparator: string = '.',
  thousandsSerparator: string = '',
): string {
  amountDivisor = limitAmountDivisor(amountDivisor)
  if (typeof decimalPlaces === 'bigint') {
    decimalPlaces = Number(decimalPlaces)
  }
  const v = Number(value) / amountDivisor
  const n = Math.min(Math.ceil(decimalPlaces), 20)
  let s
  if (n >= 0) {
    s = v.toFixed(n)
  } else {
    const numDigits = Math.ceil(Math.log10(Math.abs(v)))
    const precision = Math.min(numDigits + n, 100)
    s = precision >= 1 ? v.toPrecision(precision) : '0'
  }
  return scientificToRegular(s, decimalSeparator, thousandsSerparator)
}

export function amountToLocaleString(
  value: number | bigint,
  amountDivisor: number,
  decimalPlaces: number | bigint,
): string {
  return amountToString(value, amountDivisor, decimalPlaces, localeDecimalSeparator, '\u202F')
}

export function calcPegExampleAmount(peggedDisplay: Display, pegDisplay: Display, exchangeRate: number): number {
    let exampleAmount: number
    let prec = 4n  // We want our example to have a precision of at least 4 decimal places.
    const minPegAmount = calcSmallestDisplayableNumber(pegDisplay.amountDivisor, pegDisplay.decimalPlaces - prec)
    do {
      exampleAmount = calcSmallestDisplayableNumber(peggedDisplay.amountDivisor, peggedDisplay.decimalPlaces - prec)
      prec++
    } while (exampleAmount * exchangeRate < minPegAmount)
    return Math.min(exampleAmount, MAX_AMOUNT)
  }

function scientificToRegular(
  scientific: string,
  decimalSeparator: string,
  thousandsSerparator: string,
): string {
  const sep1000s = (s: string): string => s.replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSerparator)
  let [mantissa, exponent = '0'] = scientific.toLowerCase().split('e')
  let e = Number(exponent)
  let sign = ''
  if (mantissa.startsWith('-') || mantissa.startsWith('+')) {
    if (mantissa[0] === '-') {
      sign = '-'
    }
    mantissa = mantissa.slice(1)
  }
  if (!Number.isFinite(e)) {
    throw new SyntaxError(scientific)
  }
  const decimalPointIndex = mantissa.indexOf('.')
  if (decimalPointIndex > -1) {
    e -= (mantissa.length - decimalPointIndex - 1)
    mantissa = removeLeadingZeroes(mantissa.slice(0, decimalPointIndex) + mantissa.slice(decimalPointIndex + 1))
  }
  switch (true) {
    case e >= 0:
      return sign + sep1000s(mantissa + '0'.repeat(e))
    case e > -mantissa.length:
      return sign + sep1000s(mantissa.slice(0, e)) + decimalSeparator + mantissa.slice(e)
    default:
      return sign + '0' + decimalSeparator + '0'.repeat(-mantissa.length - e) + mantissa
  }
}

function getLocaleDecimalSeparator(): string {
  // Can only be "." or ",". Allowing other separators will likely
  // cause more harm than good.
  const n: number = 1.1
  const separator = n.toLocaleString().substring(1, 2)
  if (separator !== ',')
    return '.'
  return separator
}

export const localeDecimalSeparator = getLocaleDecimalSeparator();

function removeLeadingZeroes(s: string): string {
  return s.match(/^0*([\s\S]*)$/)?.[1] as string
}
