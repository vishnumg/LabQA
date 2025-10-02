from __future__ import annotations
from pydantic import BaseModel, Field
from datetime import date, datetime
from typing import List, Optional

# Auth


class LoginRequest(BaseModel):
    email: str
    password: str


class TokenResponse(BaseModel):
    token: str

# Branches


class BranchOut(BaseModel):
    id: str
    name: str


class BranchList(BaseModel):
    items: List[BranchOut]


class BranchCreate(BaseModel):
    name: str


class BranchUpdate(BaseModel):
    name: str

# Parameters


class ParameterOut(BaseModel):
    id: str
    name: str
    unit: Optional[str] = None


class ParameterCreate(BaseModel):
    id: str  # e.g., "glucose", "hba1c"
    name: str  # e.g., "Glucose", "HbA1c"
    unit: Optional[str] = None  # e.g., "mg/dL", "%"


class ParameterUpdate(BaseModel):
    name: Optional[str] = None
    unit: Optional[str] = None


class ParameterList(BaseModel):
    items: List[ParameterOut]

# Targets


class TargetVersion(BaseModel):
    branch_id: str
    parameter_id: str
    level: str
    validFrom: date = Field(alias="validFrom")
    mean: float
    sd: float

    class Config:
        populate_by_name = True


class TargetList(BaseModel):
    items: List[TargetVersion]


class TargetUpsert(BaseModel):
    branch_id: str
    parameter_id: str
    level: str
    mean: float
    sd: float
    validFrom: date = Field(alias="validFrom")

    class Config:
        populate_by_name = True


class UpsertResponse(BaseModel):
    ok: bool = True

# QC


class QcEntryOut(BaseModel):
    id: str
    date: date
    parameter: str
    branch: str
    level: str
    value: float
    enteredBy: Optional[str] = None
    enteredAt: Optional[datetime] = None


class QcList(BaseModel):
    items: List[QcEntryOut]
    total: int
    limit: int
    offset: int


class QcEntryIn(BaseModel):
    date: date
    parameter: str
    branch: str
    level: str
    value: float


class QcEntryUpdate(BaseModel):
    """Update schema for QC entry - only value can be changed"""
    value: float


class QcBulkCreate(BaseModel):
    entries: List[QcEntryIn]


class QcBulkResponse(BaseModel):
    inserted: int

# Users / Technicians (admin management)


class TechnicianOut(BaseModel):
    id: str
    email: str
    branch_id: Optional[str] = None
    created_at: datetime


class TechnicianList(BaseModel):
    items: List[TechnicianOut]


class TechnicianCreate(BaseModel):
    email: str
    password: str
    branch_id: Optional[str] = None


class TechnicianUpdate(BaseModel):
    email: Optional[str] = None
    branch_id: Optional[str] = None


class PasswordChange(BaseModel):
    password: str
