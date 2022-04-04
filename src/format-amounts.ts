export const MAX_INT64 = (1n << 63n) - 1n
export const MIN_INT64 = -MAX_INT64 - 1n
export const MAX_AMOUNT = Number(MAX_INT64)
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
  return scientificToRegular(s)
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

function scientificToRegular(scientific: string): string {
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
      return sign + mantissa + '0'.repeat(e)
    case e > -mantissa.length:
      return sign + mantissa.slice(0, e) + '.' + mantissa.slice(e)
    default:
      return sign + '0.' + '0'.repeat(-mantissa.length - e) + mantissa
  }
}

function removeLeadingZeroes(s: string): string {
  return s.match(/^0*([\s\S]*)$/)?.[1] as string
}
