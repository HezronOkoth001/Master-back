const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { put } = require("@vercel/blob");

const db = require("../config/database");
const authMiddleware = require("../middleware/auth");

const router = express.Router();

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
]);

// Vercel server requests are limited to 4.5 MB, so keep each image below that.
const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_ARTICLE_IMAGES = 10;

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();

    if (
      !ALLOWED_MIME_TYPES.has(file.mimetype) ||
      !ALLOWED_EXTENSIONS.has(extension)
    ) {
      return cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE"));
    }

    cb(null, true);
  },
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    fields: 10,
  },
});

const uploadSingleImage = (req, res, next) => {
  upload.single("file")(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          message: "Each image must be 4MB or smaller.",
        });
      }

      if (error.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({
          message: "Only JPG, PNG and WEBP images are allowed.",
        });
      }

      return res.status(400).json({
        message: "Invalid image upload.",
      });
    }

    console.error("Image upload error:", error.message);
    return res.status(400).json({
      message: "Image upload failed.",
    });
  });
};

const createLocalFilename = (file) => {
  const extension = path.extname(file.originalname).toLowerCase();
  return Date.now() + "-" + Math.random().toString(36).slice(2, 12) + extension;
};

const storeImage = async (file) => {
  // Local development fallback.
  if (!process.env.VERCEL) {
    const uploadsDir = path.join(__dirname, "../uploads");
    fs.mkdirSync(uploadsDir, { recursive: true });

    const filename = createLocalFilename(file);
    fs.writeFileSync(path.join(uploadsDir, filename), file.buffer);

    return `/uploads/${filename}`;
  }

  // Production storage on Vercel.
  // Create a Public Vercel Blob store connected to this project first.
  const extension = path.extname(file.originalname).toLowerCase();
  const filename =
    `blog-images/${Date.now()}-${Math.random().toString(36).slice(2, 12)}${extension}`;

  const blob = await put(filename, file.buffer, {
    access: "public",
    addRandomSuffix: false,
    contentType: file.mimetype,
    cacheControlMaxAge: 31536000,
  });

  return blob.url;
};

const isValidImageUrl = (value) => {
  if (!value || typeof value !== "string") return false;

  if (value.startsWith("/uploads/")) return true;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

const normalizeArticleImages = (value) => {
  if (value === undefined || value === null || value === "") return [];

  let images = value;

  if (typeof value === "string") {
    try {
      images = JSON.parse(value);
    } catch {
      images = [value];
    }
  }

  if (!Array.isArray(images)) return [];

  return images
    .filter(isValidImageUrl)
    .slice(0, MAX_ARTICLE_IMAGES);
};

// ========================================
// UPLOAD ONE IMAGE
// ========================================

router.post(
  "/upload-image",
  authMiddleware,
  uploadSingleImage,
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        message: "Please select an image.",
      });
    }

    try {
      const url = await storeImage(req.file);

      return res.status(201).json({
        message: "Image uploaded successfully.",
        url,
      });
    } catch (error) {
      console.error("Persistent image upload failed:", error.message);

      return res.status(503).json({
        message:
          "Image storage is not configured. Connect a Vercel Blob store to the backend project and try again.",
      });
    }
  }
);

// ========================================
// GET ALL BLOG POSTS
// ========================================

router.get("/", (req, res) => {
  const sql = `
    SELECT *
    FROM blogs
    ORDER BY published_at DESC
  `;

  db.query(sql, (err, results) => {
    if (err) {
      console.error("Error fetching blogs:", err.message);
      return res.status(500).json({
        message: "Failed to fetch blog posts",
      });
    }

    return res.json(results);
  });
});

// ========================================
// GET ONE BLOG POST
// ========================================

router.get("/:id", (req, res) => {
  const { id } = req.params;

  const blogSql = `
    SELECT *
    FROM blogs
    WHERE id = ?
  `;

  db.query(blogSql, [id], (err, results) => {
    if (err) {
      console.error("Error fetching blog:", err.message);
      return res.status(500).json({
        message: "Failed to fetch blog post",
      });
    }

    if (results.length === 0) {
      return res.status(404).json({
        message: "Blog post not found",
      });
    }

    const blog = results[0];

    const imageSql = `
      SELECT id, image_path, created_at
      FROM blog_images
      WHERE blog_id = ?
      ORDER BY created_at ASC
    `;

    db.query(imageSql, [id], (imageError, images) => {
      if (imageError) {
        console.error(
          "Error fetching article images:",
          imageError.message
        );

        return res.status(500).json({
          message: "Failed to fetch article images",
        });
      }

      blog.article_images = images;
      return res.json(blog);
    });
  });
});

// ========================================
// CREATE BLOG POST
// ========================================

router.post("/", authMiddleware, async (req, res) => {
  const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
  const author =
    typeof req.body.author === "string" ? req.body.author.trim() : "";
  const content =
    typeof req.body.content === "string" ? req.body.content.trim() : "";
  const coverImage = isValidImageUrl(req.body.cover_image)
    ? req.body.cover_image
    : null;
  const articleImages = normalizeArticleImages(req.body.article_images);

  if (!title || !author || !content) {
    return res.status(400).json({
      message: "Title, author, and content are required",
    });
  }

  const sql = `
    INSERT INTO blogs
    (title, author, content, cover_image)
    VALUES (?, ?, ?, ?)
  `;

  db.query(
    sql,
    [title, author, content, coverImage],
    (err, result) => {
      if (err) {
        console.error("Error creating blog:", err.message);
        return res.status(500).json({
          message: "Failed to create blog post",
        });
      }

      const blogId = result.insertId;

      if (articleImages.length === 0) {
        return res.status(201).json({
          message: "Blog post created successfully",
          blogId,
          cover_image: coverImage,
          article_images: [],
        });
      }

      const imageValues = articleImages.map((image) => [
        blogId,
        image,
      ]);

      const imageSql = `
        INSERT INTO blog_images
        (blog_id, image_path)
        VALUES ?
      `;

      db.query(imageSql, [imageValues], (imageError) => {
        if (imageError) {
          console.error(
            "Error saving article images:",
            imageError.message
          );

          return res.status(500).json({
            message:
              "Blog created but article images could not be saved",
          });
        }

        return res.status(201).json({
          message: "Blog post created successfully",
          blogId,
          cover_image: coverImage,
          article_images: articleImages,
        });
      });
    }
  );
});

// ========================================
// UPDATE BLOG POST
// ========================================

router.put("/:id", authMiddleware, async (req, res) => {
  const { id } = req.params;

  const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
  const author =
    typeof req.body.author === "string" ? req.body.author.trim() : "";
  const content =
    typeof req.body.content === "string" ? req.body.content.trim() : "";

  if (!title || !author || !content) {
    return res.status(400).json({
      message: "Title, author, and content are required",
    });
  }

  const coverImage =
    req.body.cover_image === null || req.body.cover_image === ""
      ? null
      : isValidImageUrl(req.body.cover_image)
        ? req.body.cover_image
        : undefined;

  const articleImages = normalizeArticleImages(req.body.article_images);

  const updateSql =
    coverImage !== undefined
      ? `
          UPDATE blogs
          SET title = ?, author = ?, content = ?, cover_image = ?
          WHERE id = ?
        `
      : `
          UPDATE blogs
          SET title = ?, author = ?, content = ?
          WHERE id = ?
        `;

  const updateValues =
    coverImage !== undefined
      ? [title, author, content, coverImage, id]
      : [title, author, content, id];

  db.query(updateSql, updateValues, (err, result) => {
    if (err) {
      console.error("Error updating blog:", err.message);
      return res.status(500).json({
        message: "Failed to update blog post",
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Blog post not found",
      });
    }

    db.query(
      "DELETE FROM blog_images WHERE blog_id = ?",
      [id],
      (deleteError) => {
        if (deleteError) {
          console.error(
            "Error replacing article images:",
            deleteError.message
          );

          return res.status(500).json({
            message: "Blog updated but article images could not be replaced",
          });
        }

        if (articleImages.length === 0) {
          return res.json({
            message: "Blog post updated successfully",
            article_images: [],
          });
        }

        const imageValues = articleImages.map((image) => [id, image]);

        db.query(
          `
            INSERT INTO blog_images
            (blog_id, image_path)
            VALUES ?
          `,
          [imageValues],
          (imageError) => {
            if (imageError) {
              console.error(
                "Error saving article images:",
                imageError.message
              );

              return res.status(500).json({
                message:
                  "Blog updated but article images could not be saved",
              });
            }

            return res.json({
              message: "Blog post updated successfully",
              article_images: articleImages,
            });
          }
        );
      }
    );
  });
});

// ========================================
// DELETE BLOG POST
// ========================================

router.delete("/:id", authMiddleware, (req, res) => {
  const { id } = req.params;

  db.query(
    "DELETE FROM blog_images WHERE blog_id = ?",
    [id],
    (imageError) => {
      if (imageError) {
        console.error(
          "Error deleting article images:",
          imageError.message
        );

        return res.status(500).json({
          message: "Failed to delete blog images",
        });
      }

      db.query(
        "DELETE FROM blogs WHERE id = ?",
        [id],
        (err, result) => {
          if (err) {
            console.error("Error deleting blog:", err.message);
            return res.status(500).json({
              message: "Failed to delete blog post",
            });
          }

          if (result.affectedRows === 0) {
            return res.status(404).json({
              message: "Blog post not found",
            });
          }

          return res.json({
            message: "Blog post deleted successfully",
          });
        }
      );
    }
  );
});

module.exports = router;
