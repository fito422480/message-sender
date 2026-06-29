# Arquitectura del Sistema

Este documento describe la arquitectura técnica del sistema WhatsApp Message Sender con diagramas Mermaid.

## 📋 Índice

- [Vista General](#vista-general)
- [Componentes](#componentes)
- [Flujo de Datos](#flujo-de-datos)
- [Persistencia](#persistencia)
- [Kubernetes](#kubernetes)

---

## Vista General

```mermaid
flowchart TB
    subgraph Internet
        User[👤 Usuario]
        WA[📱 WhatsApp]
    end
    
    subgraph K8s["Kubernetes Cluster"]
        subgraph Ingress
            ING[🌐 nginx-ingress]
        end
        
        subgraph Backend["Backend Pods"]
            API1[Express API #1]
            API2[Express API #2]
        end
        
        subgraph Storage["Almacenamiento Persistente"]
            PG[(🐘 PostgreSQL)]
            Redis[(🔴 Redis)]
            S3[📦 MinIO/S3]
        end
        
        subgraph Auth
            KC[🔐 Keycloak]
        end
    end
    
    User -->|HTTPS| ING
    ING --> API1 & API2
    API1 & API2 --> PG
    API1 & API2 --> Redis
    API1 & API2 --> S3
    API1 & API2 --> WA
    User -->|Auth| KC
    KC --> ING
```

---

## Componentes

### Frontend (SPA)

```mermaid
flowchart LR
    subgraph Frontend["public/"]
        HTML[index.html]
        CSS[css/app.css]
        JS1[js/core.js]
        JS2[js/messages.js]
        JS3[js/contacts.js]
        JS4[js/dashboard.js]
        JS5[js/whatsapp.js]
        JS6[js/main.js]
    end
    
    subgraph Features
        Dashboard[📊 Dashboard]
        Contacts[📇 Contactos]
        Messages[💬 Mensajes]
        WhatsApp[📱 Conexión WA]
    end
    
    HTML --> Features
    CSS --> Features
    JS1 --> Features
    JS2 --> Features
    JS3 --> Features
    JS4 --> Features
    JS5 --> Features
    JS6 --> Features
```

### Backend (Node.js/Express)

```mermaid
flowchart TB
    subgraph API["src/"]
        Routes[routes.js]
        Auth[auth.js]
        Manager[manager.js]
        Queue[queueRedis.js]
        Metrics[metricsStore.js]
    end
    
    subgraph Adapters
        PGClient[postgresClient.js]
        RedisClient[redisClient.js]
        S3Client[storage/s3.js]
    end
    
    subgraph Stores
        MetricsFS[metricsStoreFirestore.js]
        MetricsPG[metricsStorePostgres.js]
        MetricsStub[stub sin persistencia]
        AuthState[stores/redisAuthState.js]
    end
    
    Routes --> Auth
    Routes --> Manager
    Routes --> Queue
    Routes --> Metrics
    
    Metrics -->|Firebase Admin available| MetricsFS
    Metrics -->|fallback: POSTGRES_HOST| MetricsPG
    Metrics -->|fallback| MetricsStub
    
    MetricsFS --> Firebase[(Firestore)]
    MetricsPG --> PGClient
    AuthState --> RedisClient
    Manager --> S3Client
```

### Selección de Backend de Persistencia

```mermaid
flowchart TD
    Start[metricsStore.js] --> CheckFirebase{Firebase Admin<br/>disponible?}
    CheckFirebase -->|Sí| UseFS[metricsStoreFirestore.js]
    CheckFirebase -->|No| CheckPG{POSTGRES_HOST<br/>definido?}
    CheckPG -->|Sí| UsePG[metricsStorePostgres.js]
    CheckPG -->|No| UseStub[stub sin persistencia]
    
    UseFS --> Firestore[(Firestore)]
    UsePG --> PG[(PostgreSQL)]
    UsePG --> RedisCache[(Redis Cache)]
    UseStub --> NoDB[(sin persistencia)]
```

---

## Flujo de Datos

### Envío de Campaña

```mermaid
sequenceDiagram
    autonumber
    participant U as 👤 Usuario
    participant FE as 🖥️ Frontend
    participant API as ⚙️ Express
    participant DB as 🐘 PostgreSQL
    participant Q as 📋 BullMQ
    participant WA as 📱 WhatsApp
    participant R as 🔴 Redis
    
    U->>FE: Cargar CSV + mensaje
    FE->>API: POST /send-messages
    
    API->>DB: Upsert contactos
    API->>DB: INSERT campaign
    API->>DB: INSERT campaign_recipients
    
    API->>Q: enqueueCampaign(campaignId)
    API-->>FE: { campaignId, queued: N }
    
    loop Por cada destinatario
        Q->>WA: sendMessage(phone, content)
        alt Éxito
            WA-->>Q: ACK
            Q->>DB: UPDATE recipient status=sent
            Q->>DB: INSERT metric_event(sent)
        else Error
            WA-->>Q: ERROR
            Q->>DB: UPDATE recipient status=error
            Q->>DB: INSERT metric_event(error)
        end
    end
    
    Q->>DB: UPDATE campaign status=finished
    
    U->>FE: Ver Dashboard
    FE->>API: GET /dashboard/*
    API->>DB: SELECT métricas
    API-->>FE: { timeline, groups, stats }
```

### Gestión de Contactos (Paginado + Modal)

```mermaid
sequenceDiagram
    autonumber
    participant U as 👤 Usuario
    participant FE as 🖥️ Frontend
    participant API as ⚙️ Express
    participant DB as 🐘 PostgreSQL

    U->>FE: Abrir sección Contactos
    FE->>API: GET /contacts?search=&group=&page=&pageSize=
    API->>DB: SELECT paginado + COUNT(*)
    DB-->>API: items + total
    API-->>FE: { items, total, page, pageSize }

    U->>FE: Click en editar (lápiz)
    FE->>API: GET /contacts/:contactId
    API->>DB: SELECT contacto por ID
    DB-->>API: contacto
    API-->>FE: contacto
    FE->>U: Modal de edición

    U->>FE: Guardar cambios
    FE->>API: PUT /contacts/:contactId
    API->>DB: UPDATE contacts
    API-->>FE: { success, contact }

    Note over FE,API: En "Enviar > Por contacto" se reutiliza GET /contacts con paginación server-side
```

### Conexión WhatsApp

```mermaid
sequenceDiagram
    autonumber
    participant U as 👤 Usuario
    participant FE as 🖥️ Frontend
    participant API as ⚙️ Express
    participant SM as 📦 SessionManager
    participant WM as 🔌 WhatsAppManager
    participant R as 🔴 Redis
    participant WA as 📱 WhatsApp
    
    U->>FE: Acceder a /whatsapp
    FE->>API: GET /connection-status
    
    API->>SM: getSessionByToken(req)
    SM->>R: GET session:{userId}
    
    alt Sesión existente
        R-->>SM: sessionData
        SM->>WM: restore()
    else Nueva sesión
        SM->>WM: new WhatsAppManager(userId)
        WM->>WA: connect()
        WA-->>WM: QR code
        WM->>R: SETEX qr:{userId}
    end
    
    WM-->>API: { state, qr }
    API-->>FE: { connected: false, qrUrl }
    
    FE->>FE: Mostrar QR
    U->>WA: Escanear QR
    WA-->>WM: authenticated
    WM->>R: SETEX creds:{userId}
    
    FE->>API: GET /connection-status
    API-->>FE: { connected: true, phone }
```

### Limpiar Caché de Usuario

```mermaid
sequenceDiagram
    participant U as 👤 Usuario
    participant FE as 🖥️ Frontend
    participant API as ⚙️ Express
    participant MS as 📊 metricsStore
    participant R as 🔴 Redis
    
    U->>FE: Click "Limpiar Caché"
    FE->>FE: confirm()
    FE->>API: DELETE /cache/user
    
    API->>MS: clearUserCache(userId)
    MS->>R: SCAN user:{userId}:*
    MS->>R: DEL matched keys
    R-->>MS: deletedCount
    
    MS-->>API: { deletedKeys: N }
    API-->>FE: { success, deletedKeys }
    
    FE->>FE: showAlert("Caché limpiado")
    FE->>API: GET /dashboard/*
```

---

## Persistencia

### Esquema de Base de Datos (PostgreSQL)

```mermaid
erDiagram
    CONTACTS {
        uuid id PK
        varchar user_id
        varchar phone UK
        varchar nombre
        varchar sustantivo "tratamiento in API"
        varchar grupo
        varchar source
        timestamp created_at
        timestamp updated_at
    }
    
    CAMPAIGNS {
        uuid id PK
        varchar user_id
        varchar name
        varchar status
        text message_template
        jsonb media_config
        int total_recipients
        int sent_count
        int error_count
        timestamp started_at
        timestamp finished_at
        timestamp created_at
    }
    
    CAMPAIGN_RECIPIENTS {
        uuid id PK
        uuid campaign_id FK
        uuid contact_id FK
        varchar phone
        varchar status
        text error_message
        timestamp sent_at
        timestamp created_at
    }
    
    METRIC_EVENTS {
        uuid id PK
        varchar user_id
        uuid campaign_id FK
        uuid contact_id FK
        varchar event_type
        jsonb metadata
        timestamp created_at
    }
    
    MONTHLY_STATS {
        uuid id PK
        varchar user_id
        varchar month
        int sent
        int errors
        timestamp updated_at
    }
    
    CONTACT_STATS {
        uuid id PK
        uuid contact_id FK
        varchar month
        int sent
        int errors
        timestamp updated_at
    }
    
    CAMPAIGNS ||--o{ CAMPAIGN_RECIPIENTS : "tiene"
    CONTACTS ||--o{ CAMPAIGN_RECIPIENTS : "recibe"
    CAMPAIGNS ||--o{ METRIC_EVENTS : "genera"
    CONTACTS ||--o{ METRIC_EVENTS : "asociado"
    CONTACTS ||--o{ CONTACT_STATS : "estadísticas"
```

### Claves Redis

```mermaid
flowchart LR
    subgraph SessionKeys["Sesiones WhatsApp"]
        S1[wa:session:{userId}:creds]
        S2[wa:session:{userId}:keys:*]
        S3[qr:{userId}]
    end
    
    subgraph QueueKeys["Cola BullMQ"]
        Q1[bull:whatsapp-queue:*]
        Q2[bull:whatsapp-queue:jobs:{jobId}]
    end
    
    subgraph CacheKeys["Caché Métricas (fallback)"]
        C1[user:{userId}:contacts:*]
        C2[user:{userId}:campaigns:*]
        C3[user:{userId}:metrics:*]
    end
    
    subgraph LockKeys["Distributed Locks"]
        L1[lock:{resourceId}]
        L2[owner:{resourceId}]
    end
```

---

## Kubernetes

### Deployment Architecture

```mermaid
flowchart TB
    subgraph Internet
        Client[👤 Cliente]
        CertManager[📜 cert-manager]
    end
    
    subgraph Namespace["namespace: sender"]
        subgraph Ingress
            ING[nginx-ingress<br/>sender.mindtechpy.net]
        end
        
        subgraph Backend
            DEP[Deployment: sender-backend<br/>replicas: 1-5]
            SVC[Service: sender-backend-service<br/>ClusterIP:3010]
            KEDA[KEDA ScaledObject<br/>scale-to-zero]
        end
        
        subgraph Database
            PGDEP[Deployment: sender-postgres]
            PGSVC[Service: sender-postgres<br/>ClusterIP:5432]
            PVC[PVC: sender-postgres-pvc<br/>5Gi Longhorn]
        end
        
        subgraph Secrets
            SEC1[Secret: backend-env-secrets]
            SEC2[Secret: sender-postgres-secret]
            SEC3[Secret: ghcr-secret]
        end
        
        subgraph Config
            CM[ConfigMap: sender-backend-config]
            PGINIT[ConfigMap: sender-postgres-init]
        end
    end
    
    subgraph External
        Redis[🔴 Redis<br/>redis.mindtechpy.net]
        MinIO[📦 MinIO<br/>s3.mindtechpy.net]
        Keycloak[🔐 Keycloak<br/>auth.mindtechpy.net]
    end
    
    Client -->|HTTPS| ING
    CertManager -->|TLS| ING
    ING --> SVC
    SVC --> DEP
    KEDA --> DEP
    
    DEP --> SEC1
    DEP --> CM
    
    PGDEP --> SEC2
    PGDEP --> PGINIT
    PGDEP --> PVC
    PGSVC --> PGDEP
    DEP --> PGSVC
    
    DEP --> Redis
    DEP --> MinIO
    DEP --> Keycloak
```

### CI/CD Pipeline

```mermaid
flowchart LR
    subgraph GitHub
        Push[git push main]
        Actions[GitHub Actions]
        GHCR[ghcr.io]
    end
    
    subgraph Runner["Self-hosted Runner"]
        Test[npm test]
        Build[docker build]
        Deploy[kubectl apply]
    end
    
    subgraph K8s["Kubernetes"]
        NS[namespace.yaml]
        SEC[Secrets]
        PG[postgresql.yaml]
        CM[configmap.yaml]
        BE[backend-deployment.yaml]
        ING[ingress.yaml]
    end
    
    Push --> Actions
    Actions --> Test
    Test --> Build
    Build --> GHCR
    GHCR --> Deploy
    
    Deploy --> NS
    NS --> SEC
    SEC --> PG
    PG --> CM
    CM --> BE
    BE --> ING
```

---

## Métricas y Monitoreo

### Dashboard Overview

```mermaid
flowchart TB
    subgraph KPIs["KPIs Mensuales"]
        K1[📤 Enviados<br/>este mes]
        K2[❌ Errores<br/>este mes]
        K3[📊 Tasa éxito<br/>%]
        K4[📈 Promedio<br/>diario]
    end
    
    subgraph Charts["Gráficos"]
        C1[📈 Timeline<br/>Tendencia diaria]
        C2[🥧 Pie Chart<br/>Por grupo]
        C3[🏆 Top 10<br/>Contactos]
    end
    
    subgraph Data["Fuentes de Datos"]
        D1[/dashboard/current-month]
        D2[/dashboard/timeline]
        D3[/dashboard/by-group]
        D4[/dashboard/by-contact]
    end
    
    D1 --> KPIs
    D2 --> C1
    D3 --> C2
    D4 --> C3
```

---

## Seguridad

```mermaid
flowchart TB
    subgraph Auth["Autenticación"]
        KC[Keycloak OIDC]
        JWT[JWT Validation]
        Roles[Role-based Access]
    end
    
    subgraph Transport["Transporte"]
        TLS[TLS 1.3]
        HTTPS[HTTPS Only]
        CORS[CORS Policy]
    end
    
    subgraph Data["Datos"]
        Encrypt[Encryption at Rest<br/>Longhorn]
        Secrets[K8s Secrets]
        TTL[Redis TTL]
    end
    
    subgraph App["Aplicación"]
        Input[Input Validation]
        RateLimit[Rate Limiting]
        Sanitize[XSS Prevention]
    end
    
    KC --> JWT --> Roles
    TLS --> HTTPS --> CORS
    Encrypt --> Secrets --> TTL
    Input --> RateLimit --> Sanitize
```
