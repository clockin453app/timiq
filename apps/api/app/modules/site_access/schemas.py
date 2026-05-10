import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SiteAccessCreateRequest(BaseModel):
    user_id: uuid.UUID
    location_id: uuid.UUID


class SiteAccessDeleteRequest(BaseModel):
    user_id: uuid.UUID
    location_id: uuid.UUID


class SiteAccessResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    location_id: uuid.UUID
    created_at: datetime