from dotenv import load_dotenv

# Must run before importing anything under app.routes/app.services, since
# app.services.gemini constructs its Gemini client at import time and needs
# GEMINI_API_KEY already present in the environment.
load_dotenv()

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes.extract import router as extract_router
from app.routes.eligibility import router as eligibility_router

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="BridgePath AI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(extract_router, prefix="/api")
app.include_router(eligibility_router, prefix="/api")
