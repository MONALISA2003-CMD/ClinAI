"""ClinAI AI service boundary. Production implementation should add Vertex/Gemini, retrieval, safety, evaluation and model audit here."""
from fastapi import FastAPI
from pydantic import BaseModel
app=FastAPI(title='ClinAI AI Service')
class Context(BaseModel): patient_id:str|None=None; purpose:str; clinical_context:dict={}
@app.get('/health')
def health(): return {'ok':True,'service':'clinai-ai'}
@app.post('/v1/assist')
def assist(c:Context): return {'status':'review_required','purpose':c.purpose,'answer':None,'safety':['Do not use as autonomous diagnosis or treatment','Clinician review required'],'provenance':[]}
