

# CMPT 362 Rooms Backend — API Usage

**Base URL**

```
https://cmpt362-rooms-backend.joshua-z-luo.workers.dev
```

## Create a room

```
POST /rooms
```

**Response**

```json
{ "code": "ABC123" }
```

##  Join a room (auto-assigns userId + token)

```
POST /rooms/:code/join
Content-Type: application/json
```

**Body (name optional)**

```json
{ "name": "Alice" }
```

**Response**

```json
{ "ok": true, "userId": "u_xxxxx", "token": "yyyyy" }
```

> Save `userId` and `token` — you’ll need them for updates and leaving.

##  Update location (auth required)

```
POST /rooms/:code/loc
Content-Type: application/json
```

**Body**

```json
{ "userId": "u_xxxxx", "token": "yyyyy", "lat": 49.28, "lon": -123.12 }
```

**Response**

```json
{ "ok": true }
```

##  Leave room (auth required)

```
POST /rooms/:code/leave
Content-Type: application/json
```

**Body**

```json
{ "userId": "u_xxxxx", "token": "yyyyy" }
```

**Response**

```json
{ "ok": true }
```

## Get room state

```
GET /rooms/:code/state
```

**Response (tokens are hidden)**

```json
{
  "members": [
    {
      "userId": "u_xxxxx",
      "name": "Alice",
      "loc": { "lat": 49.28, "lon": -123.12, "ts": 1730836800000 },
      "updatedAt": 1730836800000
    }
  ]
}
```