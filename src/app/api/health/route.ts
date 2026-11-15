export function GET() {
  return Response.json({ status: 'ok', service: 'saathicare' }, { headers: { 'Cache-Control': 'no-store' } })
}
