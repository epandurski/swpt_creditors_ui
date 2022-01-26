const MAX_INT64 = (1n << 63n) - 1n
const MIN_INT64 = -MAX_INT64 - 1n
const MIN_AMOUNT_DIVISOR = 1e-99

export function stringToAmount(s: string | number, amountDivisor: number): bigint {
  assert(amountDivisor >= 0)
  amountDivisor = Math.max(amountDivisor, MIN_AMOUNT_DIVISOR)
  const amount = BigInt(Math.round(Number(s) * amountDivisor))
  if (amount <= MIN_INT64) return MIN_INT64
  if (amount >= MAX_INT64) return MAX_INT64
  return amount
}

export function amountToString(value: bigint, amountDivisor: number, decimalPlaces: number | bigint): string {
  assert(amountDivisor >= 0)
  amountDivisor = Math.max(amountDivisor, MIN_AMOUNT_DIVISOR)
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
