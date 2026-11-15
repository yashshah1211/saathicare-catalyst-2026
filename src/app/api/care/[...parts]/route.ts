import { accept, acknowledge, invite, optIn, removeMember, revoke } from '@/lib/server/circle'
import { handoff } from '@/lib/server/handoff'
import { ApiError, authenticate, failure, input, json } from '@/lib/server/platform'
import { createProfile, dashboard, deleteAppointment, deleteMedication, listProfiles, profileRef, respondToDose, saveAppointment, saveMedication, settings } from '@/lib/server/store'
import { acceptInput, appointmentInput, doseInput, id, inviteInput, medicationInput, optInInput, profileInput, settingsInput } from '@/lib/validation'

type Context = { params: Promise<{ parts: string[] }> }

async function route(request: Request, context: Context) {
  try {
    const actor = await authenticate(request)
    const { parts } = await context.params
    const { method } = request
    const [root, profileId, resource, recordId] = parts
    if (parts.length === 1 && root === 'profiles') {
      if (method === 'GET') return json(await listProfiles(actor))
      if (method === 'POST') return json(await createProfile(actor, await input(request, profileInput)), 201)
    }
    if (parts.length === 1 && root === 'join' && method === 'POST') return json(await accept(actor, (await input(request, acceptInput)).code))
    if (root !== 'profiles' || parts.length > 4 || !id.safeParse(profileId).success || (recordId && !id.safeParse(recordId).success)) throw new ApiError(404, 'Page not found.')
    const profile = profileRef(profileId)

    if (!resource && method === 'GET') return json(await dashboard(profile, actor))
    if (resource === 'settings' && !recordId && method === 'PUT') {
      await settings(profile, actor, await input(request, settingsInput))
      return json({ ok: true })
    }
    if (resource === 'medications') {
      if (method === 'POST' && !recordId) return json(await saveMedication(profile, actor, await input(request, medicationInput)), 201)
      if (method === 'PUT' && recordId) return json(await saveMedication(profile, actor, await input(request, medicationInput), recordId))
      if (method === 'DELETE' && recordId) { await deleteMedication(profile, actor, recordId); return json({ ok: true }) }
    }
    if (resource === 'appointments') {
      if (method === 'POST' && !recordId) return json(await saveAppointment(profile, actor, await input(request, appointmentInput)), 201)
      if (method === 'PUT' && recordId) return json(await saveAppointment(profile, actor, await input(request, appointmentInput), recordId))
      if (method === 'DELETE' && recordId) { await deleteAppointment(profile, actor, recordId); return json({ ok: true }) }
    }
    if (resource === 'doses' && recordId && method === 'PUT') return json(await respondToDose(profile, actor, recordId, await input(request, doseInput)))
    if (resource === 'invitations') {
      if (method === 'POST' && !recordId) {
        const body = await input(request, inviteInput)
        return json(await invite(profile, actor, body.email, body.role), 201)
      }
      if (method === 'DELETE' && recordId) { await revoke(profile, actor, recordId); return json({ ok: true }) }
    }
    if (resource === 'members') {
      if (method === 'PUT' && !recordId) { await optIn(profile, actor, (await input(request, optInInput)).optedIn); return json({ ok: true }) }
      if (method === 'DELETE' && recordId) { await removeMember(profile, actor, recordId); return json({ ok: true }) }
    }
    if (resource === 'notifications' && recordId && method === 'PUT') { await acknowledge(profile, actor, recordId); return json({ ok: true }) }
    if (resource === 'handoff' && !recordId && method === 'POST') return json(await handoff(profile, actor))
    throw new ApiError(404, 'Page not found.')
  } catch (error) { return failure(error) }
}

export { route as GET, route as POST, route as PUT, route as DELETE }
