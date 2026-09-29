const express = require("express");
const path = require("path");
const multer = require("multer");

const db = require("../config/database");
const authMiddleware = require("../middleware/auth");

const router = express.Router();


// ========================================
// IMAGE UPLOAD CONFIGURATION
// ========================================

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

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../uploads"));
  },

  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname).toLowerCase();

    const safeName =
      Date.now() +
      "-" +
      Math.random().toString(36).slice(2, 12) +
      extension;

    cb(null, safeName);
  },
});

const fileFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname).toLowerCase();

  if (
    !ALLOWED_MIME_TYPES.has(file.mimetype) ||
    !ALLOWED_EXTENSIONS.has(extension)
  ) {
    return cb(
      new multer.MulterError("LIMIT_UNEXPECTED_FILE"),
      false
    );
  }

  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 11,
    fields: 20,
  },
});

const uploadBlogImages = (req, res, next) => {
  upload.fields([
    { name: "cover_image", maxCount: 1 },
    { name: "article_images", maxCount: 10 },
  ])(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          message: "Each image must be 5MB or smaller.",
        });
      }

      if (error.code === "LIMIT_FILE_COUNT") {
        return res.status(400).json({
          message: "Too many files were uploaded.",
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
      console.error(
        "Error fetching blogs:",
        err.message
      );

      return res.status(500).json({
        message: "Failed to fetch blog posts",
      });
    }

    res.json(results);
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
      console.error(
        "Error fetching blog:",
        err.message
      );

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

    db.query(
      imageSql,
      [id],
      (imageError, images) => {
        if (imageError) {
          console.error(
            "Error fetching article images:",
            imageError.message
          );

          return res.status(500).json({
            message:
              "Failed to fetch article images",
          });
        }

        blog.article_images = images;

        res.json(blog);
      }
    );
  });
});


// ========================================
// CREATE BLOG POST
// ========================================

router.post(
  "/",
   authMiddleware,
  uploadBlogImages,
  (req, res) => {

    const {
      title,
      author,
      content,
    } = req.body;


    // ----------------------------------------
    // VALIDATE BLOG DATA
    // ----------------------------------------

    if (!title || !author || !content) {
      return res.status(400).json({
        message:
          "Title, author, and content are required",
      });
    }


    // ----------------------------------------
    // COVER IMAGE
    // ----------------------------------------

    let coverImage = null;

    if (
      req.files &&
      req.files.cover_image &&
      req.files.cover_image.length > 0
    ) {
      coverImage =
        `/uploads/${req.files.cover_image[0].filename}`;
    }


    // ----------------------------------------
    // CREATE BLOG
    // ----------------------------------------

    const sql = `
      INSERT INTO blogs
      (title, author, content, cover_image)
      VALUES (?, ?, ?, ?)
    `;

    const values = [
      title,
      author,
      content,
      coverImage,
    ];


    db.query(
      sql,
      values,
      (err, result) => {

        if (err) {
          console.error(
            "Error creating blog:",
            err.message
          );

          return res.status(500).json({
            message:
              "Failed to create blog post",
          });
        }


        const blogId = result.insertId;


        // ----------------------------------------
        // ARTICLE IMAGES
        // ----------------------------------------

        const articleImages =
          req.files &&
          req.files.article_images
            ? req.files.article_images
            : [];


        // No article images
        if (articleImages.length === 0) {

          return res.status(201).json({
            message:
              "Blog post created successfully",

            blogId: blogId,

            cover_image: coverImage,

            article_images: [],
          });
        }


        // ----------------------------------------
        // SAVE ARTICLE IMAGE PATHS
        // ----------------------------------------

        const imageValues =
          articleImages.map((file) => [
            blogId,
            `/uploads/${file.filename}`,
          ]);


        const imageSql = `
          INSERT INTO blog_images
          (blog_id, image_path)
          VALUES ?
        `;


        db.query(
          imageSql,
          [imageValues],
          (imageError) => {

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
              message:
                "Blog post created successfully",

              blogId: blogId,

              cover_image: coverImage,

              article_images:
                imageValues.map(
                  (image) => image[1]
                ),
            });
          }
        );
      }
    );
  }
);


// ========================================
// UPDATE BLOG POST
// ========================================

router.put(
  "/:id",
  authMiddleware,
  uploadBlogImages,
  (req, res) => {

    const { id } = req.params;

    const {
      title,
      author,
      content,
    } = req.body;


    // ----------------------------------------
    // VALIDATE
    // ----------------------------------------

    if (!title || !author || !content) {
      return res.status(400).json({
        message:
          "Title, author, and content are required",
      });
    }


    // ----------------------------------------
    // CHECK COVER IMAGE
    // ----------------------------------------

    const hasNewCoverImage =
      req.files &&
      req.files.cover_image &&
      req.files.cover_image.length > 0;


    let sql;
    let values;


    if (hasNewCoverImage) {

      const coverImage =
        `/uploads/${req.files.cover_image[0].filename}`;


      sql = `
        UPDATE blogs
        SET
          title = ?,
          author = ?,
          content = ?,
          cover_image = ?
        WHERE id = ?
      `;


      values = [
        title,
        author,
        content,
        coverImage,
        id,
      ];

    } else {

      sql = `
        UPDATE blogs
        SET
          title = ?,
          author = ?,
          content = ?
        WHERE id = ?
      `;


      values = [
        title,
        author,
        content,
        id,
      ];
    }


    // ----------------------------------------
    // UPDATE BLOG
    // ----------------------------------------

    db.query(
      sql,
      values,
      (err, result) => {

        if (err) {
          console.error(
            "Error updating blog:",
            err.message
          );

          return res.status(500).json({
            message:
              "Failed to update blog post",
          });
        }


        if (result.affectedRows === 0) {
          return res.status(404).json({
            message:
              "Blog post not found",
          });
        }


        // ----------------------------------------
        // NEW ARTICLE IMAGES
        // ----------------------------------------

        const articleImages =
          req.files &&
          req.files.article_images
            ? req.files.article_images
            : [];


        if (articleImages.length === 0) {

          return res.json({
            message:
              "Blog post updated successfully",

            article_images: [],
          });
        }


        const imageValues =
          articleImages.map((file) => [
            id,
            `/uploads/${file.filename}`,
          ]);


        const imageSql = `
          INSERT INTO blog_images
          (blog_id, image_path)
          VALUES ?
        `;


        db.query(
          imageSql,
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


            res.json({
              message:
                "Blog post updated successfully",

              article_images:
                imageValues.map(
                  (image) => image[1]
                ),
            });
          }
        );
      }
    );
  }
);


// ========================================
// DELETE BLOG POST
// ========================================

router.delete("/:id", 
  authMiddleware,
  (req, res) => {

  const { id } = req.params;


  const sql = `
    DELETE FROM blogs
    WHERE id = ?
  `;


  db.query(
    sql,
    [id],
    (err, result) => {

      if (err) {
        console.error(
          "Error deleting blog:",
          err.message
        );

        return res.status(500).json({
          message:
            "Failed to delete blog post",
        });
      }


      if (result.affectedRows === 0) {
        return res.status(404).json({
          message:
            "Blog post not found",
        });
      }


      res.json({
        message:
          "Blog post deleted successfully",
      });
    }
  );
});


module.exports = router;