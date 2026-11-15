import Image from 'next/image'
import Link from 'next/link'

export function Brand() {
  return <Link className="brand" href="/" aria-label="SaathiCare home"><Image src="/mark.svg" alt="" width={42} height={42} />SaathiCare</Link>
}
