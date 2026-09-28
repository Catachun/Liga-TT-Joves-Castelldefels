# Integració Jotform → Firestore (sol·licituds de federació)

Quan algú envia el formulari de federació a Jotform, aquesta funció el marca
automàticament com "sol·licitud enviada" al seu perfil de l'app (cercant-lo
pel correu electrònic). El número de llicència real l'entra el club a mà des
del panell d'administració quan la FCTT el confirma — Jotform no el sap, així
que això no es pot automatitzar del tot.

## 1. Clau de servei de Firebase

1. Firebase Console → engranatge (Project settings) → pestanya **Service accounts**.
2. Botó **Generate new private key** → es descarrega un `.json`.
3. Obre'l i copia TOT el contingut (és un únic objecte JSON).

## 2. Variables d'entorn a Netlify

Site settings → Environment variables → afegeix:

| Clau | Valor |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | tot el contingut del `.json` del pas 1, enganxat tal qual (una sola línia és més segur) |
| `JOTFORM_WEBHOOK_SECRET` | `EEMmSTD9bMO7rxmnfYuLswDY_Avikxyg` (ja generat; el pots canviar si vols) |

## 3. Connectar Netlify amb el repositori de GitHub (necessari per a les Functions)

Les Netlify Functions **no funcionen amb l'arrossega-i-deixa anar manual**
que fas servir ara — cal que el lloc estigui connectat directament al
repositori de GitHub perquè Netlify les detecti i les desplegui soles.

1. A Netlify → el teu site `circuittt` → **Site configuration → Build & deploy → Link repository** (o crea un site nou "Import from Git" apuntant a `Catachun/Liga-TT-Joves-Castelldefels`, carpeta base `circuit-app/`).
2. Build command: `npm run build`. Publish directory: `circuit-app/public`. Functions directory: `circuit-app/netlify/functions` (ja ho defineix `netlify.toml`, però confirma-ho).
3. A partir d'aquí, cada `git push` a `main` desplegarà sol — ja no caldrà pujar el zip a mà.

Si prefereixes seguir pujant el zip a mà per ara i deixar la integració
automàtica per més endavant, no passa res: el formulari i la guia ja
funcionen igualment, només que hauràs de marcar tu la federació a mà al
panell (que ja pots fer amb el botó nou de "Número de llicència" a la
gestió de jugadors).

## 4. Configurar el webhook a Jotform

1. Obre el formulari → **Settings → Integrations → Webhooks**.
2. Afegeix aquesta URL (canvia `TU-SITE` pel domini real un cop desplegat):
   `https://circuittt.netlify.app/.netlify/functions/federate-webhook?secret=EEMmSTD9bMO7rxmnfYuLswDY_Avikxyg`
3. Desa.

A partir d'aquí, cada sol·licitud federativa marcarà automàticament el
jugador corresponent (per email) com "Sol·licitud de federació enviada" a
l'app.
