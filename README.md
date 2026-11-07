# Agenda Deportiva 2026

PWA (React + Vite + Tailwind) con función serverless en Vercel.

## Variables de entorno (Vercel → Settings → Environment Variables)
- `FOOTBALL_DATA_KEY` (obligatoria): token de football-data.org
- `DEPOR_ID` (opcional): ID del Dépor en football-data.org (por defecto 241)
- `ICS_MOTOGP`, `ICS_WRC`, `ICS_WEC`, `ICS_GT` (opcionales): URL del feed .ics de cada campeonato

## Desarrollo local
    npm install
    npx vercel dev     # sirve front + /api/deportes
