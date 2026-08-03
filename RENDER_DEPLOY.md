# Déployer le backend sur Render (GitHub)

Repo GitHub : https://github.com/elieferdinahlowane-afk/-ENDOSCOPIE

## 1. Pousser le code sur GitHub

```bash
cd E:\CHU\Endoscopie

# Ajouter le dépôt GitHub (si pas déjà fait)
git remote add github https://github.com/elieferdinahlowane-afk/-ENDOSCOPIE.git

# Commiter vos changements (sans le fichier .env !)
git add endoscopie-back endoscopie-front
git commit -m "Préparer le backend pour le déploiement Render"
git push github main
```

Si la branche par défaut est `master` : `git push github master`

## 2. Créer le service Web sur Render

1. Aller sur [https://dashboard.render.com](https://dashboard.render.com)
2. **New +** → **Web Service**
3. Connecter le compte **GitHub** et choisir le repo **elieferdinahlowane-afk/-ENDOSCOPIE**
4. Renseigner :

| Champ | Valeur |
|--------|--------|
| **Name** | `endoscopie-api` |
| **Root Directory** | `endoscopie-back` |
| **Runtime** | Node |
| **Build Command** | `npm install --include=dev && npx prisma generate && npm run build` |
| **Start Command** | `npm run start:prod` |
| **Instance type** | Free (ou payant selon besoin) |

## 3. Variables d'environnement (Render → Environment)

| Variable | Valeur |
|----------|--------|
| `DATABASE_URL` | URL PostgreSQL Render (voir étape 4) — avec `?sslmode=require` à la fin |
| `PORT` | *(laissé vide : Render injecte automatiquement)* |
| `NODE_ENV` | `production` |
| `FRONTEND_URL` | URL de votre front (ex. `https://votre-front.onrender.com`) — optionnel en dev |

**Ne jamais** commiter le fichier `.env` sur GitHub.

## 4. Base PostgreSQL Render

Si vous avez déjà une base (ex. `endoscopie_bd` sur Oregon) :

1. Render → votre base **PostgreSQL** → **Connections**
2. Copier **External Database URL**
3. Ajouter à la fin : `?sslmode=require`
4. Coller dans `DATABASE_URL` du Web Service

Pour une **nouvelle** base : **New +** → **PostgreSQL**, puis lier l’URL au Web Service.

Après le premier déploiement, appliquer le schéma (en local, une fois) :

```bash
cd endoscopie-back
# DATABASE_URL = URL Render dans .env temporairement
npx prisma db push
```

## 5. CORS

Le backend accepte les origines listées dans `FRONTEND_URL` (séparées par des virgules).

Exemple Render :

```
FRONTEND_URL=https://endoscopie-front.onrender.com,http://localhost:3000
```

## 6. Vérifier le déploiement

URL Render du type : `https://endoscopie-api.onrender.com`

- `GET https://endoscopie-api.onrender.com/` → réponse NestJS
- `GET https://endoscopie-api.onrender.com/api/salles` → JSON des salles
- Documentation Swagger : `https://endoscopie-api.onrender.com/api/docs`

## 7. Connecter le frontend

Dans le front (Vercel / Render / local), définir :

```
NEXT_PUBLIC_API_URL=https://endoscopie-api.onrender.com
```

Ou utiliser le proxy Next uniquement en local (`next.config.ts`).

## Dépannage

| Problème | Solution |
|----------|----------|
| Build échoue sur Prisma | Vérifier `buildCommand` avec `npx prisma generate` |
| `Cannot find module dist/.../main.js` | `start:prod` doit être `node dist/main.js` |
| `Application failed to respond` | Vérifier que le build a réussi et que `DATABASE_URL` est défini |
| Erreur DB | `DATABASE_URL` + `?sslmode=require` |
| CORS | Ajouter l’URL du front dans `FRONTEND_URL` |
| Service Free lent | Premier appel après veille ≈ 30–60 s |
