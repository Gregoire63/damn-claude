/**
 * Le message à MONTRER quand un appel au serveur échoue.
 *
 * `ofetch` compose le sien avec la ligne de statut HTTP : « [POST]
 * "/api/auth/register": 403 ». En HTTP/2 — donc chez tout hébergeur moderne — la
 * phrase explicative n'existe tout simplement plus dans le protocole, et il ne reste
 * que le nombre. Le serveur, lui, prend soin de dire « Ce code de démarrage a déjà
 * servi » ou « Trop de tentatives. Réessaie dans quinze minutes » : c'est dans le
 * CORPS de la réponse, et personne ne le lisait.
 *
 * Quelqu'un voyait donc « 403 » après avoir posé son doigt sur le capteur, sans
 * savoir s'il fallait retaper le code, en chercher un autre, ou attendre un quart
 * d'heure. Les trois se réparent différemment.
 *
 * Les erreurs du navigateur — capteur refusé, fenêtre fermée, appareil sans
 * biométrie — n'ont pas de corps : elles gardent leur propre message, qui est déjà
 * le bon.
 */
export function messageErreur(e: unknown): string {
  const err = e as { data?: { statusMessage?: string, message?: string }, statusMessage?: string }
  const duServeur = err?.data?.statusMessage || err?.data?.message || err?.statusMessage
  const m = duServeur || (e instanceof Error ? e.message : String(e))
  return String(m).replace(/^Error:\s*/, '')
}
