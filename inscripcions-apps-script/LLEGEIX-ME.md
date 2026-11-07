# Preinscripcions web → Drive + full de la Kim

1. Obre https://script.google.com amb el compte propietari del full JOVES_BD_2627 → **Nou projecte**.
2. Esborra el codi que hi ha i enganxa tot el contingut de `Code.gs`.
3. Comprova `SHEET_ID` (el full de la Kim) i `NOTIFY_EMAIL`.
4. Executa la funció `provaLocal` (permisos: Drive, Fulls de càlcul, Correu → Permet). Ha de crear una fila de prova a la pestanya WEB_ENTRADES i una carpeta de prova a Drive.
5. **Implementa → Nova implementació → Aplicació web**: executar com *Jo*, accés *Qualsevol persona*. Copia la URL acabada en `/exec`.
6. Posa aquesta URL a `inscripcio.html` (`CONFIG.SCRIPT_URL`) i publica.
7. Esborra la fila i la carpeta de prova.
