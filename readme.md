# CMPT 362 Rooms Backend — API Usage

**Base URL**

```
https://cmpt362-rooms-backend.joshua-z-luo.workers.dev
```

---

## Create a room

```
POST /rooms
```

**Response**

```json
{ "code": "ABC123" }
```

---

## Join a room  
(returns your `userId` + `token`)

```
POST /rooms/:code/join
Content-Type: application/json
```

**Body (name / team / role / health optional)**

```json
{ "name": "Alice", "team": "red", "role": "scout", "health": 100 }
```

**Response**

```json
{ "ok": true, "userId": "u_xxxxx", "token": "yyyyy" }
```

Save **userId** and **token** — required for all updates.

---

## Update location

```
POST /rooms/:code/loc
Content-Type: application/json
```

**Body**

```json
{
  "userId": "u_xxxxx",
  "token": "yyyyy",
  "lat": 49.28,
  "lon": -123.12
}
```

**Response**

```json
{ "ok": true }
```

---

## Activate an ability

```
POST /rooms/:code/ability
Content-Type: application/json
```

**Body**

```json
{
  "userId": "u_xxxxx",
  "token": "yyyyy",
  "abilityId": "scan"
}
```

**Response**

```json
{ "ok": true }
```

Each activation is stored in the user's ability log with a timestamp.

---

## Update player status  
(team, role, health)

```
POST /rooms/:code/status
Content-Type: application/json
```

**Body**

```json
{
  "userId": "u_xxxxx",
  "token": "yyyyy",
  "team": "blue",
  "role": "medic",
  "health": 75
}
```

**Response**

```json
{ "ok": true }
```

---

## Leave room

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

---

## Get room state  
(tokens are always hidden)

```
GET /rooms/:code/state
```

**Response**

```json
{
  "members": [
    {
      "userId": "u_xxxxx",
      "name": "Alice",
      "loc": { "lat": 49.28, "lon": -123.12, "ts": 1730836800000 },
      "updatedAt": 1730836800000,
      "abilities": [
        { "id": "scan", "ts": 1730836820000 }
      ],
      "status": {
        "team": "hunter",
        "role": "scout",
        "health": 100
      }
    }
  ]
}
```

---

## Get room settings

```
GET /rooms/:code/settings
```

**Response**

```json
{
  "settings": [
    { "key": "gameStart", "value": "on" },
    { "key": "abilities", "value": "on" },
    { "key": "fog", "value": "off" }
  ]
}
```

---

## Update room settings  
(replaces the entire settings array)

```
POST /rooms/:code/settings
Content-Type: application/json
```

**Body**

```json
{
  "settings": [
    { "key": "gameStart", "value": "on" },
    { "key": "abilities", "value": "on" },
    { "key": "fog", "value": "off" }
  ]
}
```

**Response**

```json
{ "ok": true }
```
