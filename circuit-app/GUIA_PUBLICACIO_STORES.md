# TT Circuit — llesta per pujar-la a les stores

## Què he deixat ja fet (desplegat en producció)

- `manifest.json` complet: `id`, `scope`, `lang`, `categories`, icones en
  "any" i "maskable" per separat (192 i 512px), i dreceres (shortcuts) a
  Rànquing i Jornades.
- Icones ja existents (16/32/180/192/512px) — l'icona de 512px ja té prou
  marge per funcionar com a icona "maskable" (Android la pot retallar en
  cercle/squircle sense perdre el logo).
- Pàgina de **política de privacitat** pública a `/privacitat.html`
  (enllaçada des de la pestanya Normes de l'app) — obligatòria per a
  totes dues stores, sobretot perquè es recullen fotos i dades de menors.
- Gràfic de capçalera (feature graphic) 1024×500px a `store-assets/`
  (adjunt), per a la fitxa de Google Play.

**Res d'això trenca res de l'app actual** — són afegits, no canvis de
comportament.

## El que falta i només ho pots fer tu (comptes/pagaments)

### Pas 1 — Generar els paquets amb PWABuilder (gratuït, 10 min)
1. Vés a **https://www.pwabuilder.com**
2. Introdueix la URL: `https://circuittt.netlify.app`
3. Deixa que analitzi el manifest i el service worker (hauria de sortir
   amb bona puntuació ara que el manifest està complet)
4. Botó **"Package for stores"** → tria **Android** i genera el paquet
   (.aab signat per PWABuilder, o puja la teva pròpia clau si ja en tens)
5. Repeteix amb l'opció **iOS** → descarrega el projecte Xcode generat

### Pas 2 — Android / Google Play
1. Crear compte a **Google Play Console** → https://play.google.com/console
   (pagament únic **25 $**)
2. Crear una "aplicació nova"
3. Pujar el `.aab` generat per PWABuilder
4. Omplir la fitxa de la botiga:
   - Icona: `public/icons/icon-512.png` (ja la tens)
   - Gràfic de capçalera: `store-assets/feature-graphic-1024x500.png` (adjunt)
   - Captures de pantalla del mòbil (mínim 2): **encara pendents** — les
     puc generar jo mateix la propera vegada que tingui accés al
     navegador, o me les pots enviar tu fetes amb el mòbil
   - Descripció curta i llarga: les tens més avall, ja escrites
   - Política de privacitat: `https://circuittt.netlify.app/privacitat.html`
5. Enviar a revisió — normalment triguen 1-3 dies

### Pas 3 — iOS / App Store
1. Crear compte a **Apple Developer Program** → https://developer.apple.com
   (**99 $/any**, cal un Mac per fer el següent pas)
2. Obrir el projecte Xcode que genera PWABuilder, compilar-lo i pujar-lo
   amb **Xcode** o **Transporter** a App Store Connect
3. Crear la fitxa a **App Store Connect** amb les mateixes dades
   (descripció, captures, política de privacitat)
4. Apple revisa més a fons que Google — pot demanar justificar que l'app
   aporta valor més enllà d'"obrir una web" (el login, el rànquing, les
   fotos i les jornades ho justifiquen bé)
5. Revisió: normalment 1-3 dies, de vegades amb alguna pregunta per correu

## Textos ja redactats per a les fitxes

**Nom:** TT Circuit — TTJ Castelldefels

**Descripció curta (Play Store, màx. 80 car.):**
> Rànquing ELO i jornades del Circuit Obert de Tennis Taula TTJ Castelldefels

**Descripció llarga:**
> TT Circuit és l'aplicació oficial del Circuit Obert de Tennis Taula del
> Club Tennis Taula Joves de Castelldefels.
>
> Amb TT Circuit pots:
> • Consultar el rànquing ELO en temps real
> • Inscriure't a les jornades del circuit
> • Introduir i consultar resultats dels teus partits
> • Veure el teu perfil, les teves insígnies i la teva evolució
> • Consultar el reglament i la informació del club
>
> Pensada per a totes les edats i nivells, des de la iniciació fins a la
> competició federada. Gestionada pel Club Tennis Taula Joves de
> Castelldefels (TTJ Castelldefels).

**Categoria:** Esports

**Política de privacitat:** https://circuittt.netlify.app/privacitat.html

## Resum de costos

| Concepte | Cost |
|---|---|
| Google Play Console | 25 $ (pagament únic) |
| Apple Developer Program | 99 $ / any |
| PWABuilder | Gratuït |

## Pendent per la meva banda
- Captures de pantalla reals del mòbil (2-5, format vertical) — ho faig
  en quant tingui el navegador disponible, o me les envies tu fetes des
  del teu mòbil i les retoco si cal.
