@echo off
rem Duplo clique para rodar. Na primeira vez cria o ambiente e instala tudo.
cd /d "%~dp0"
if not exist .venv (
  echo Criando ambiente...
  python -m venv .venv || (echo Python nao encontrado. Instale em python.org && pause && exit /b 1)
  .venv\Scripts\python -m pip install -q -r requirements.txt || (pause && exit /b 1)
)
.venv\Scripts\python app.py
pause
