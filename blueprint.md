# 🧪 Medical Lab QA Dashboard – Complete High-Level Blueprint (Finalized Roles & Responsibilities)

## 1. **Objective**
A simple multi-branch QC dashboard that:
- Allows Branch Technicians to enter daily QC data for their branch only.
- Allows Admin (QA Officer) to manage targets, view and analyze all data, review alerts, and generate reports.
- Calculates Z-scores and evaluates Westgard rules.
- Generates PDF reports for monthly review.
- Runs entirely on **free tiers** (Vercel + NeonDB).

---

## 2. **System Architecture**
- **Frontend:** Next.js (React) on Vercel.
- **Backend:** FastAPI (Python) on Vercel Functions.
- **Database:** NeonDB (Postgres) with SQLModel.

---

## 3. **User Roles**

### **Admin (QA Officer)**
- Manage branches, parameters, and users.
- Create/update targets (mean & SD).
- View all QC entries across branches.
- Analyze data using Levey–Jennings charts and rule-based alerts.
- Acknowledge alerts.
- Generate monthly PDF/CSV reports for any branch.

### **Branch Technician**
- Enter daily L1/L2/L3 QC data for their branch.
- View only a simple table of their submitted entries (no charts or analysis).

---

## 4. **Database Schema**
| Table | Key Fields |
|------|------------|
| **users** | id, name, email, password_hash, role (admin/technician), branch_id, created_at |
| **branches** | id, name |
| **parameters** | id, name, unit |
| **targets** | id, branch_id, parameter_id, level, mean, sd, valid_from |
| **qc_entries** | id, branch_id, parameter_id, level, date, value, entered_by |
| **alerts** | id, entry_id, rule, severity, acknowledged |

---

## 5. **Workflows**

### **Branch Technician**
- Logs in and lands directly on **Data Entry Form**.
- Selects date and parameter, enters L1/L2/L3 values.
- Submits → Backend computes Z-scores and stores.
- Can view a simple table of past entries they submitted (for verification).

### **Admin (QA Officer)**
- Full dashboard with:
  - Branch and parameter filters.
  - LJ charts with ±1/±2/±3 SD reference lines.
  - Table of entries across all branches.
  - Alert management (view + acknowledge).
  - Target mean/SD management.
  - User management (add/edit technicians).
  - Report generation (PDF/CSV).

---

## 6. **Westgard Rules Engine**
- 1₂s, 1₃s, 2₂s, R₄s, 4₁s, 10ₓ applied per parameter/level.
- Alerts stored in DB, displayed in Admin dashboard.

---

## 7. **API Endpoints**
| Method | Endpoint | Role |
|-------|----------|------|
| POST | /auth/login | Admin/Technician |
| GET | /qc_entries | Admin (all branches) / Technician (own entries only) |
| POST | /qc_entries | Technician |
| GET | /targets | Admin only |
| POST | /targets | Admin |
| GET | /alerts | Admin only |
| PATCH | /alerts/:id/ack | Admin |
| GET | /reports/monthly | Admin |
| POST | /users | Admin (create technicians) |

---

## 8. **Frontend Pages**
- **Login Page**
- **Branch Technician View**
  - Data Entry Form (L1/L2/L3)
  - Table of Submitted Entries
- **Admin Dashboard**
  - Charts & Filters
  - All Entries Table
  - Alerts Management
  - Targets Management
  - User Management
  - Report Generator

---

## 9. **Non-Functional Requirements**
- Minimal and focused — designed for small-scale personal/lab use.
- JWT auth, bcrypt password hashing.
- Audit trail for data entry, target updates, and alert acknowledgments.

---

## 10. **PDF Reporting**
- Build HTML template with Jinja2.
- Render with **WeasyPrint** to PDF.
- Embed LJ charts as images for selected branch/parameter.
- Include summary statistics and list of alerts triggered in the reporting period.

---
