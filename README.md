# Tsinjo — Backend API

API REST [NestJS](https://nestjs.com) / PostgreSQL pour la plateforme anti-gaspillage alimentaire, consommée par les clients Web (React) et Mobile (React Native).

## Prérequis

- Node.js `^20.19`, `^22.12` ou `>=24` (Prisma ORM 7)
- PostgreSQL avec une base dédiée (par exemple `tsinjo`)

## Démarrage rapide

```bash
npm install
cp .env.example .env
# Renseigner DATABASE_URL, JWT_ACCESS_SECRET et JWT_REFRESH_SECRET dans .env
# (générer les secrets avec : openssl rand -hex 32)
npx prisma generate
npx prisma migrate dev
npx prisma db seed
npm run start:dev
```

Le serveur écoute sur `http://localhost:3000` (ou le port défini par `PORT`).

## Documentation et intégration frontend

- Documentation interactive (Swagger) : **http://localhost:3000/api/docs**
- Base URL de l'API : `http://localhost:3000/api/v1`
- Connexion : `POST /api/v1/auth/login` avec `{ "identifier": "<email ou téléphone>", "password": "..." }`
- La réponse contient `accessToken` et `refreshToken` ; envoyer `Authorization: Bearer <accessToken>` sur les routes protégées.
- Renouvellement : `POST /api/v1/auth/refresh` avec `{ "refreshToken": "..." }`.
- Les fichiers statiques des offres sont servis depuis `/uploads/offers/<uuid>.jpg`.

## Comptes de test

Générés par `prisma/seed.ts` avec le mot de passe commun **`Tsinjo@2026`** (téléphones vérifiés) :

| Rôle | Email | Téléphone |
| --- | --- | --- |
| Admin | `admin@tsinjo.mg` | `+261320000001` |
| Marchand — Boulangerie Analakely | `boulangerie@tsinjo.mg` | `+261320000002` |
| Marchand — Restaurant Ivandry | `restaurant@tsinjo.mg` | `+261320000003` |
| Utilisateur | `hery@tsinjo.mg` | `+261320000004` |
| Utilisateur | `noro@tsinjo.mg` | `+261320000005` |

Le seed crée également 2 boutiques vérifiées et 5 offres (dont une offre gratuite sans marchand), avec des échéances calculées au moment du seed.

## Vérification

```bash
npm run build
npm run test
```
