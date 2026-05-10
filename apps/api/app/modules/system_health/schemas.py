from pydantic import BaseModel


class SystemHealthResponse(BaseModel):
    app: str
    environment: str
    status: str
    database: str
    storage: str
