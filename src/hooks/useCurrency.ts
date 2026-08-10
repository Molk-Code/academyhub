import { useSchool, type CurrencyCode } from '@/contexts/SchoolContext'

const SYMBOL: Record<CurrencyCode, string> = {
  SEK: 'kr',
  EUR: '€',
  USD: '$',
}

export function useCurrency() {
  const { currency } = useSchool()

  const symbol = SYMBOL[currency]

  function fmt(amount: number | null | undefined): string {
    if (amount == null) return ''
    const n = Math.round(amount)
    if (currency === 'SEK') return `${n.toLocaleString('sv-SE')} kr`
    if (currency === 'EUR') return `€${n.toLocaleString('en-US')}`
    return `$${n.toLocaleString('en-US')}`
  }

  return { currency, symbol, fmt }
}
