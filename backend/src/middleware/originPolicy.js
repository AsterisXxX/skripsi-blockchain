export const allowedOrigins = Object.freeze([
  "http://localhost:5173",
  "http://localhost:8080",
  "https://nexusmed.my.id",
]);

export function requireAllowedOrigin(req, res, next) {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  if (!allowedOrigins.includes(req.headers.origin)) {
    return res.status(403).json({
      error: "Origin tidak diizinkan.",
    });
  }

  next();
}
