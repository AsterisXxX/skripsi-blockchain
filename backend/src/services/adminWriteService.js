import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import {
  findInstitutionById,
  findUserByUsername,
  createStaffWithRole,
} from "../repositories/adminWriteRepository.js";

export class AdminServiceError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "AdminServiceError";
    this.statusCode = statusCode;
  }
}

export function createStaffUser(input, actorUserId) {
  const {
    username,
    password,
    institutionId,
    role,
  } = input ?? {};

  if (
    typeof username !== "string" ||
    !/^[a-z][a-z0-9_]{3,31}$/.test(username) ||
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 128 ||
    typeof institutionId !== "string" ||
    !["org1", "org2"].includes(institutionId)
  ) {
    throw new AdminServiceError(400, "Data pengguna tidak valid.");
  }

  const expectedRole =
    institutionId === "org1"
      ? "referral_sender"
      : "referral_receiver";

  if (role !== expectedRole) {
    throw new AdminServiceError(
      400,
      "Role tidak sesuai izin institusi.",
    );
  }

  const institution = findInstitutionById(institutionId);

  if (
    !institution ||
    institution.status !== "approved" ||
    (role === "referral_sender" && institution.can_send !== 1) ||
    (role === "referral_receiver" && institution.can_receive !== 1)
  ) {
    throw new AdminServiceError(
      403,
      "Institusi tidak memiliki izin untuk role ini.",
    );
  }

  const existing = findUserByUsername(username);

  if (
    existing ||
    ["org1", "org2", "nexusadmin"].includes(username)
  ) {
    throw new AdminServiceError(
      409,
      "Username sudah digunakan.",
    );
  }

  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  const userId = randomUUID();

  try {
    createStaffWithRole({
      userId,
      username,
      passwordHash: `${salt}:${hash}`,
      institutionId,
      role,
      actorUserId,
    });
  } catch (error) {
    if (error.code?.startsWith("SQLITE_CONSTRAINT")) {
      throw new AdminServiceError(
        409,
        "Data pengguna sudah ada atau tidak valid.",
      );
    }

    throw error;
  }

  return {
    status: "created",
    user: {
      id: userId,
      username,
      institutionId,
      role,
      status: "active",
    },
  };
}
