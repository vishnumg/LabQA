from __future__ import annotations
from sqlmodel import SQLModel, Field, Column, Date, Relationship
from typing import Optional
from datetime import date, datetime
import uuid


class Branch(SQLModel, table=True):
    __tablename__ = "branches"  # type: ignore  # align with migration
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str


class User(SQLModel, table=True):
    __tablename__ = "users"  # type: ignore  # align with migration
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    role: str
    branch_id: Optional[uuid.UUID] = Field(default=None, foreign_key="branches.id")
    created_at: datetime = Field(default_factory=datetime.utcnow)


class Target(SQLModel, table=True):
    __tablename__ = "targets"  # type: ignore  # align with migration
    branch_id: uuid.UUID = Field(foreign_key="branches.id", primary_key=True)
    parameter_id: str = Field(primary_key=True)
    level: str = Field(primary_key=True)
    valid_from: date = Field(sa_column=Column("valid_from", Date, primary_key=True))
    mean: float
    sd: float


class Parameter(SQLModel, table=True):
    """Dedicated parameters table (id + name + optional unit)."""
    __tablename__ = "parameters"  # type: ignore
    id: str = Field(primary_key=True)
    name: str
    unit: Optional[str] = None


class QcEntry(SQLModel, table=True):
    __tablename__ = "qc_entries"  # type: ignore  # align with migration
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    date: date
    parameter: str
    branch: uuid.UUID = Field(foreign_key="branches.id")
    level: str
    value: float
    entered_by: Optional[str] = None
    entered_at: Optional[datetime] = None
