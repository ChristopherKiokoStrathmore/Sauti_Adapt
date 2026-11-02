from enum import Enum
from typing import Literal
from pydantic import BaseModel, Field

class Intent(str, Enum):
    SCROLL_DOWN = 'SCROLL_DOWN'
    SCROLL_UP = 'SCROLL_UP'
    GO_BACK = 'GO_BACK'
    READ_PAGE = 'READ_PAGE'
    UNDO = 'UNDO'
    UNKNOWN = 'UNKNOWN'

class Language(str, Enum):
    KENYAN_ENGLISH = 'en-KE'
    KISWAHILI = 'sw-KE'

class Recognition(BaseModel):
    status: Literal['accepted', 'rejected']
    intent: Intent = Intent.UNKNOWN
    language: Language | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    model_version: str | None = None
    reason: str | None = None


def reject(reason: str, *, version: str | None = None) -> Recognition:
    return Recognition(status='rejected', reason=reason, model_version=version)
