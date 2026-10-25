const API_URL = "http://localhost:3001/api";

export async function checkBackend() {
  const response = await fetch(`${API_URL}/health`);

  if (!response.ok) {
    throw new Error("Backend tidak merespons");
  }

  return response.json();
}
