# RW Dashboard Sync API

## Deploy to Railway

1. Create a new Railway project (or add a service to existing)
2. Connect this folder as a GitHub repo **or** use Railway CLI:
   ```
   railway init
   railway up
   ```
3. Add a **PostgreSQL** database service in Railway — it auto-sets `DATABASE_URL`
4. Set these environment variables in Railway:

| Variable | Value |
|---|---|
| `JWT_SECRET` | Any long random string (e.g. `openssl rand -hex 32`) |
| `DASHBOARD_USERS` | JSON array of users (see below) |
| `PORT` | `3000` (Railway sets this automatically) |

### DASHBOARD_USERS format
```json
[
  {"username":"jayden","password":"yourpassword"},
  {"username":"kayla","password":"anotherpassword"},
  {"username":"joseph","password":"thirdpassword"}
]
```

5. Copy your Railway service URL (e.g. `https://rw-dashboard-api.up.railway.app`)
6. Paste it into `RW_Dashboard_v2.html` where indicated:
   ```js
   const SYNC_API_URL = 'https://rw-dashboard-api.up.railway.app';
   ```

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/login` | None | Get JWT token |
| GET | `/auth/verify` | Bearer | Verify token |
| GET | `/snapshot` | Bearer | All state in one call |
| GET | `/state/:key` | Bearer | Get one state value |
| PUT | `/state/:key` | Bearer | Set one state value |
| GET | `/health` | None | Health check |

## State Keys

| Key | Contains |
|---|---|
| `aucMeta` | Auction type, venue, date, order, collapse state per property |
| `aucChecks` | Checklist ticks per property |
| `aucEventCats` | Event categories (name + date) |
| `formRequests` | Form 6 and Contract requests |
| `formChecks` | Form checklist ticks |
| `preLaunch` | Manual pre-launch property entries |
