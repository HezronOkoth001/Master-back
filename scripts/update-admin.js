require("dotenv").config();

const bcrypt = require("bcryptjs");
const db = require("../config/database");

async function updateAdmin() {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      throw new Error(
        "ADMIN_EMAIL or ADMIN_PASSWORD is missing from .env"
      );
    }

    // Get the first existing admin account
    const admins = await new Promise((resolve, reject) => {
      db.query(
        "SELECT id, email FROM admins ORDER BY id LIMIT 1",
        (error, results) => {
          if (error) {
            reject(error);
          } else {
            resolve(results);
          }
        }
      );
    });

    if (admins.length === 0) {
      throw new Error("No admin account was found in the database.");
    }

    const adminId = admins[0].id;
    const oldEmail = admins[0].email;

    // Create a secure bcrypt password hash
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    // Update the existing admin account
    await new Promise((resolve, reject) => {
      db.query(
        "UPDATE admins SET email = ?, password = ? WHERE id = ?",
        [adminEmail, passwordHash, adminId],
        (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        }
      );
    });

    console.log("");
    console.log("=================================");
    console.log("ADMIN CREDENTIALS UPDATED");
    console.log("=================================");
    console.log(`Previous email: ${oldEmail}`);
    console.log(`New email: ${adminEmail}`);
    console.log("Password: updated securely");
    console.log("=================================");
    console.log("");

    process.exit(0);
  } catch (error) {
    console.error("");
    console.error("Failed to update admin credentials:");
    console.error(error.message);
    console.error("");

    process.exit(1);
  }
}

updateAdmin();