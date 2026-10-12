// FAQ del TT Circuit (pestanya Normes). Els preus venen de config.js.
export function getFaq(lang, { jornada, afi, max, wait }) {
  const F = {
    ca: [
      ["Què és el TT Circuit?", "Una lliga individual de tennis taula, oberta a tothom: gent del club i de fora. Es juga en jornades al llarg de la temporada i tothom suma al mateix rànquing ELO."],
      ["Cal estar federat?", `Sí, cal la llicència AFI. Costa ${afi} € (només una vegada, val per a tota la temporada) i es paga amb la primera jornada. Si no estàs federat, al registre marca \"No estic federat/da\" i fes la sol·licitud amb el botó que apareix.`],
      ["Sóc jugador/a del club: tinc llicència?", "Sí: tots els jugadors del club tenen llicència. El teu número te'l pot dir el teu entrenador, o el trobes a l'app Playoff del club."],
      ["Quant costa?", `${jornada} € per jornada, en efectiu el mateix dia, més la llicència AFI (${afi} € una sola vegada).`],
      ["Com és una jornada?", `Depèn de quanta gent s'inscrigui, i ho decideix l'organització: grups + Quadre Or/Plata, sistema suís (rondes aparellades per ELO) o grups nivellats. Màxim ${max} jugadors, més ${wait} en llista d'espera. Els dissabtes comença a les 9:00 (sala oberta des de les 8:20) i els diumenges a les 17:00 (sala oberta des de les 16:15).`],
      ["Com funciona l'ELO i les divisions?", "Tothom comença amb 500 punts. Guanyar a algú amb més ELO puja més. Segons els punts, entres a una divisió: Bronze, Plata, Or, Platí, Diamant o Llegenda. Els 5 primers partits mouen l'ELO més ràpid per col·locar-te aviat."],
      ["Què són les Finals?", "L'última jornada de la temporada. Hi juguen els 40 primers classificats del rànquing, per ordre, i els 3 primers guanyen premi."],
      ["Puc reptar qui vulgui?", "Els partits que compten per al rànquing es juguen a les jornades."],
      ["I si no puc venir?", "Cancel·la la inscripció des de l'app perquè un altre jugador de la llista d'espera pugui entrar."],
    ],
    es: [
      ["¿Qué es el TT Circuit?", "Una liga individual de tenis de mesa, abierta a todo el mundo: gente del club y de fuera. Se juega en jornadas a lo largo de la temporada y todos suman en el mismo ranking ELO."],
      ["¿Hace falta estar federado?", `Sí, hace falta la licencia AFI. Cuesta ${afi} € (solo una vez, vale para toda la temporada) y se paga con la primera jornada. Si no estás federado, en el registro marca \"No estoy federado/a\" y haz la solicitud con el botón que aparece.`],
      ["Soy jugador/a del club: ¿tengo licencia?", "Sí: todos los jugadores del club tienen licencia. Tu número te lo puede decir tu entrenador, o lo encuentras en la app Playoff del club."],
      ["¿Cuánto cuesta?", `${jornada} € por jornada, en efectivo el mismo día, más la licencia AFI (${afi} € una sola vez).`],
      ["¿Cómo es una jornada?", `Depende de cuánta gente se inscriba, y lo decide la organización: grupos + Cuadro Oro/Plata, sistema suizo (rondas emparejadas por ELO) o grupos nivelados. Máximo ${max} jugadores, más ${wait} en lista de espera. Los sábados empieza a las 9:00 (sala abierta desde las 8:20) y los domingos a las 17:00 (sala abierta desde las 16:15).`],
      ["¿Cómo funcionan el ELO y las divisiones?", "Todos empiezan con 500 puntos. Ganar a alguien con más ELO sube más. Según los puntos entras en una división: Bronce, Plata, Oro, Platino, Diamante o Leyenda. Los 5 primeros partidos mueven el ELO más rápido para colocarte pronto."],
      ["¿Qué son las Finales?", "La última jornada de la temporada. Juegan los 40 primeros clasificados del ranking, por orden, y los 3 primeros ganan premio."],
      ["¿Puedo retar a quien quiera?", "Los partidos que cuentan para el ranking se juegan en las jornadas."],
      ["¿Y si no puedo venir?", "Cancela la inscripción desde la app para que otro jugador de la lista de espera pueda entrar."],
    ],
    en: [
      ["What is the TT Circuit?", "An individual table tennis league open to everyone: club members and outsiders. It is played in sessions across the season and everyone climbs the same ELO ranking."],
      ["Do I need a federation licence?", `Yes, you need the AFI licence. It costs €${afi} (once only, valid for the whole season) and is paid with your first session. If you are not federated, tick \"I'm not federated\" when registering and use the button to apply.`],
      ["I'm a club player: do I have a licence?", "Yes: all club players have a licence. Your coach can give you your number, or you can find it in the club's Playoff app."],
      ["How much does it cost?", `€${jornada} per session, in cash on the day, plus the AFI licence (€${afi} once).`],
      ["What is a session like?", `It depends on how many sign up, and the organisers decide: groups + Gold/Silver bracket, Swiss system (rounds paired by ELO) or levelled groups. Maximum ${max} players plus ${wait} on the waiting list. Saturdays start at 9:00 (room open from 8:20), Sundays at 17:00 (room open from 16:15).`],
      ["How do ELO and divisions work?", "Everyone starts with 500 points. Beating someone with a higher ELO earns more. Your points place you in a division: Bronze, Silver, Gold, Platinum, Diamond or Legend. Your first 5 matches move your ELO faster so you get placed quickly."],
      ["What are the Finals?", "The last session of the season. The top 40 players in the ranking take part, in order, and the top 3 win a prize."],
      ["Can I challenge anyone?", "Matches that count towards the ranking are played in the sessions."],
      ["What if I can't come?", "Cancel your registration in the app so someone on the waiting list can take your place."],
    ],
  };
  return F[lang] || F.ca;
}
export const FAQ_TITLE = { ca: "Preguntes freqüents", es: "Preguntas frecuentes", en: "FAQ" };
