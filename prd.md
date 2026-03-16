Berikut contoh **PRD (Product Requirement Document)** untuk aplikasi **OpsPanel** yang kamu rencanakan. Aku buat versi yang realistis untuk **admin panel SSH + service orchestration untuk environment dev**.

---

# Product Requirement Document

# OpsPanel

## 1. Overview

**OpsPanel** adalah admin panel internal yang memungkinkan developer atau DevOps untuk:

* Mengakses server development melalui SSH
* Menjalankan, menghentikan, atau me-restart service
* Menjalankan beberapa service secara bersamaan
* Melihat status service dan log secara realtime
* Melacak aktivitas pengguna melalui audit log

Tujuan utama OpsPanel adalah **menyederhanakan operasi server dev** tanpa harus login manual via SSH dan menjalankan command satu per satu.

---

# 2. Problem Statement

Saat ini developer harus:

* SSH manual ke server
* Mengingat berbagai command service
* Menjalankan service satu per satu
* Mengelola banyak server secara manual

Masalah yang muncul:

* Proses lambat
* Human error tinggi
* Tidak ada audit activity
* Sulit menjalankan beberapa service sekaligus
* Tidak ada visibility status service

OpsPanel akan menyediakan **UI terpusat untuk mengontrol server dev dan service**.

---

# 3. Goals

### Primary Goals

1. Memungkinkan developer menjalankan service tanpa SSH manual
2. Mendukung start/stop/restart multiple service
3. Memberikan monitoring status service
4. Mencatat semua aktivitas user
5. Mengurangi kesalahan operasional

### Secondary Goals

* Realtime log streaming
* Service grouping per project
* Role based access control

---

# 4. Non Goals (Scope Diluar MVP)

Fitur berikut tidak termasuk dalam versi awal:

* Production deployment management
* Kubernetes orchestration
* CI/CD pipeline
* Infrastructure provisioning
* Advanced monitoring (Grafana level)

---

# 5. Target Users

### Developer

Menggunakan panel untuk:

* menjalankan service
* restart service
* melihat log

### DevOps / Admin

Menggunakan panel untuk:

* mengelola server
* mengatur service
* mengatur user access
* melihat audit log

---

# 6. Core Features

## 6.1 Authentication & User Management

User dapat login ke OpsPanel.

### Requirements

* Login menggunakan email + password
* Role based access

### Roles

**Admin**

* Manage server
* Manage services
* Manage users
* Run services
* View logs

**Developer**

* Run services
* View logs

---

# 6.2 Server Management

Admin dapat menambahkan server dev yang dapat dikontrol OpsPanel.

### Server Fields

* Server Name
* Host / IP
* SSH Port
* Username
* Authentication Type

  * SSH Key
  * Password
* Environment

  * Dev
  * Staging

### Capabilities

Admin dapat:

* Add server
* Edit server
* Delete server
* Test SSH connection

---

# 6.3 Service Management

Service adalah unit yang dapat dijalankan di server.

### Service Fields

* Service Name
* Server
* Service Type

  * systemd
  * docker
  * pm2
  * custom script
* Start Command
* Stop Command
* Restart Command
* Status Command
* Log Command

### Example

Service: `backend-api`

Start:

```
docker compose up -d api
```

Stop:

```
docker compose stop api
```

Restart:

```
docker compose restart api
```

Log:

```
docker logs -f api --tail 100
```

---

# 6.4 Service Execution

User dapat menjalankan service dari UI.

Actions:

* Start service
* Stop service
* Restart service

Execution dilakukan melalui **SSH command execution**.

Response ditampilkan dalam UI.

---

# 6.5 Multi Service Execution

User dapat menjalankan beberapa service sekaligus.

Example:

Project: `Project Alpha`

Services:

* backend-api
* worker
* scheduler
* redis

User dapat:

```
Start All
Restart All
Stop All
```

Execution berjalan **parallel dengan queue management**.

---

# 6.6 Service Status Monitoring

OpsPanel menampilkan status service.

Status:

* Running
* Stopped
* Failed
* Unknown

Status diperoleh dari `status command`.

Example:

```
systemctl is-active myapp
```

atau

```
docker ps
```

---

# 6.7 Log Streaming

User dapat melihat log service secara realtime.

Log diambil dari command:

```
docker logs -f
```

atau

```
journalctl -f
```

Realtime streaming menggunakan **WebSocket**.

---

# 6.8 Project / Service Group

Service dapat dikelompokkan menjadi project.

Example:

Project: `Alpha`

Services:

* API
* Worker
* Scheduler
* Redis

User dapat menjalankan action pada seluruh project.

---

# 6.9 Audit Logs

Semua aktivitas dicatat.

### Audit Fields

* User
* Action
* Target
* Command
* Result
* Timestamp

Example:

```
User: dev1
Action: restart
Service: backend-api
Result: success
Time: 14:20
```

---

# 7. System Architecture

### Frontend

Framework:

* Next.js
* Tailwind
* shadcn/ui

Features:

* dashboard
* service control UI
* realtime logs
* status monitoring

---

### Backend

Framework:

* Node.js
* NestJS / Express

Libraries:

* ssh2
* WebSocket
* Redis queue

Responsibilities:

* SSH command execution
* service orchestration
* authentication
* audit logging

---

### Database

Database: PostgreSQL

Main tables:

* users
* servers
* services
* projects
* executions
* audit_logs

---

### Queue System

Queue digunakan untuk:

* multi service execution
* concurrency control

Tool:

* Redis
* BullMQ

---

# 8. Security Requirements

OpsPanel harus memperhatikan keamanan karena memiliki akses server.

### Requirements

* SSH key encrypted storage
* Command whitelist
* Role based access
* Execution timeout
* Audit logging
* Disable dangerous commands

Example blocked commands:

```
rm -rf /
shutdown
reboot
mkfs
```

---

# 9. UI Pages

## Dashboard

Menampilkan:

* total servers
* running services
* failed services
* recent activity

---

## Servers

List server

Actions:

* add
* edit
* delete
* test connection

---

## Services

List services

Actions:

* start
* stop
* restart
* view logs

---

## Projects

Group services.

Actions:

* start all
* stop all
* restart all

---

## Executions

Menampilkan job execution history.

---

## Audit Logs

Menampilkan semua aktivitas user.

---

## Users

Manage users dan role.

---

# 10. Success Metrics

OpsPanel dianggap berhasil jika:

* Developer tidak perlu SSH manual untuk dev ops
* Service bisa dijalankan < 3 detik dari UI
* Error operasional berkurang
* Semua aktivitas tercatat

---

# 11. MVP Scope

Versi pertama OpsPanel akan memiliki:

* Login
* Server management
* Service management
* Start/Stop/Restart service
* Multi service execution
* Basic log streaming
* Audit logs

---

# 12. Future Roadmap

### Phase 2

* Terminal access (limited)
* Metrics dashboard
* Alerting
* Service auto restart

### Phase 3

* Agent based architecture
* Multi environment
* Advanced RBAC
* Slack / Discord integration

---

Kalau kamu mau, aku juga bisa buatkan **3 dokumen lanjutan yang biasanya dipakai setelah PRD ini**:

1️⃣ **System Design Document (SDD)**
2️⃣ **Database Schema lengkap**
3️⃣ **API Spec (OpenAPI / Swagger)**

Biasanya ini langsung dipakai untuk mulai development.
