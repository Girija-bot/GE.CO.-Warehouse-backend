const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const db = require("./db");

const app = express();

// ==========================================================
// CONFIG
// ==========================================================

const PORT = Number(process.env.PORT) || 3001;
const HOST = "0.0.0.0";

// React production build
const frontendDist = path.join(
  __dirname,
  "..",
  "frontend",
  "dist"
);

// ==========================================================
// BASIC CONFIG
// ==========================================================

app.use(cors());
app.use(express.json());

// ==========================================================
// UPLOADS
// ==========================================================

const uploadsDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, {
    recursive: true,
  });
}

app.use(
  "/uploads",
  express.static(uploadsDir)
);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },

  filename: function (req, file, cb) {
    const extension = path
      .extname(file.originalname)
      .toLowerCase();

    const safeName =
      "catalogue-" +
      Date.now() +
      "-" +
      Math.random()
        .toString(36)
        .substring(2, 8) +
      extension;

    cb(null, safeName);
  },
});

const upload = multer({
  storage,

  limits: {
    fileSize: 10 * 1024 * 1024,
  },

  fileFilter: function (req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      return cb(
        new Error(
          "Only image files are allowed."
        )
      );
    }

    cb(null, true);
  },
});

// ==========================================================
// CATALOGUE TABLE + DATABASE MIGRATION
// ==========================================================

db.exec(`
  CREATE TABLE IF NOT EXISTS catalogues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_path TEXT NOT NULL
  );
`);

try {
  const catalogueColumns = db
    .prepare(
      `PRAGMA table_info(catalogues)`
    )
    .all();

  const columnNames =
    catalogueColumns.map(
      (column) => column.name
    );

  // ------------------------------------------
  // ADD user_id IF MISSING
  // ------------------------------------------

  if (!columnNames.includes("user_id")) {
    db.exec(`
      ALTER TABLE catalogues
      ADD COLUMN user_id INTEGER
    `);

    console.log(
      "Catalogue table migrated: user_id added."
    );
  }

  // ------------------------------------------
  // ADD created_at IF MISSING
  // ------------------------------------------

  if (!columnNames.includes("created_at")) {
    db.exec(`
      ALTER TABLE catalogues
      ADD COLUMN created_at TEXT
    `);

    db.prepare(`
      UPDATE catalogues
      SET created_at = CURRENT_TIMESTAMP
      WHERE created_at IS NULL
    `).run();

    console.log(
      "Catalogue table migrated: created_at added."
    );
  }

  console.log(
    "Catalogue table ready."
  );
} catch (err) {
  console.error(
    "Catalogue table migration error:",
    err
  );
}

// ==========================================================
// HEALTH CHECK
// ==========================================================

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "GE.CO. backend is running",
  });
});

// ==========================================================
// LOGIN
// ==========================================================

app.post("/api/login", (req, res) => {
  try {
    const {
      username,
      password,
    } = req.body || {};

    if (!username || !password) {
      return res.status(400).json({
        error:
          "Username and password are required",
      });
    }

    const user = db
      .prepare(`
        SELECT
          id,
          name,
          username,
          role
        FROM users
        WHERE username = ?
          AND password = ?
      `)
      .get(
        username.trim(),
        password
      );

    if (!user) {
      return res.status(401).json({
        error: "Invalid credentials",
      });
    }

    res.json({
      user,
    });
  } catch (err) {
    console.error(
      "Login error:",
      err
    );

    res.status(500).json({
      error: "Login failed",
    });
  }
});

// ==========================================================
// PRODUCTS
// ==========================================================

app.get("/api/products", (req, res) => {
  try {
    const products = db
      .prepare(`
        SELECT
          p.*,

          p.code AS sku,

          COALESCE(
            (
              SELECT SUM(quantity)
              FROM stock_in
              WHERE product_id = p.id
            ),
            0
          ) AS received,

          COALESCE(
            (
              SELECT SUM(quantity)
              FROM stock_out
              WHERE product_id = p.id
            ),
            0
          ) AS dispatched

        FROM products p

        ORDER BY p.name
      `)
      .all();

    const result = products.map(
      (product) => ({
        ...product,

        remaining:
          Number(
            product.received || 0
          ) -
          Number(
            product.dispatched || 0
          ),
      })
    );

    res.json(result);
  } catch (err) {
    console.error(
      "Products error:",
      err
    );

    res.status(500).json({
      error: err.message,
    });
  }
});

// ==========================================================
// ADD PRODUCT
// ==========================================================

app.post(
  "/api/products",
  (req, res) => {
    try {
      const {
        sku,
        code,
        name,
        category,
        description,
        supplier,
        location,
        min_stock,
        barcode,
        qrcode,
      } = req.body || {};

      if (
        !name ||
        !String(name).trim()
      ) {
        return res.status(400).json({
          error:
            "Product name is required",
        });
      }

      const finalCode =
        String(
          sku || code || ""
        ).trim() ||
        `GECO-${Date.now()}`;

      const result = db
        .prepare(`
          INSERT INTO products
          (
            name,
            code,
            barcode,
            qrcode,
            category,
            description,
            supplier,
            location,
            min_stock
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          String(name).trim(),
          finalCode,
          barcode || null,
          qrcode || null,
          category || null,
          description || null,
          supplier || null,
          location || null,
          Number(min_stock) || 0
        );

      const product = db
        .prepare(`
          SELECT
            *,
            code AS sku
          FROM products
          WHERE id = ?
        `)
        .get(
          result.lastInsertRowid
        );

      res.status(201).json(
        product
      );
    } catch (err) {
      console.error(
        "Add product error:",
        err
      );

      res.status(400).json({
        error: err.message,
      });
    }
  }
);

// ==========================================================
// DESTINATIONS
// ==========================================================

app.get(
  "/api/destinations",
  (req, res) => {
    try {
      const destinations = db
        .prepare(`
          SELECT *
          FROM destinations
          ORDER BY name
        `)
        .all();

      res.json(
        destinations
      );
    } catch (err) {
      console.error(
        "Destinations error:",
        err
      );

      res.status(500).json({
        error: err.message,
      });
    }
  }
);

// ==========================================================
// RECEIVE STOCK
// ==========================================================

app.post(
  "/api/stock-in",
  (req, res) => {
    try {
      const {
        product_id,
        quantity,
        supplier,
        notes,
        user_id,
      } = req.body || {};

      const productId =
        Number(product_id);

      const qty =
        Number(quantity);

      if (
        !productId ||
        !qty ||
        qty <= 0
      ) {
        return res.status(400).json({
          error:
            "Product and a positive quantity are required",
        });
      }

      const product = db
        .prepare(`
          SELECT *
          FROM products
          WHERE id = ?
        `)
        .get(productId);

      if (!product) {
        return res.status(404).json({
          error:
            "Product not found",
        });
      }

      const result = db
        .prepare(`
          INSERT INTO stock_in
          (
            product_id,
            quantity,
            supplier,
            notes,
            user_id
          )
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(
          productId,
          qty,
          supplier || null,
          notes || null,
          user_id || null
        );

      const record = db
        .prepare(`
          SELECT *
          FROM stock_in
          WHERE id = ?
        `)
        .get(
          result.lastInsertRowid
        );

      res.status(201).json(
        record
      );
    } catch (err) {
      console.error(
        "Stock-in error:",
        err
      );

      res.status(500).json({
        error: err.message,
      });
    }
  }
);

// ==========================================================
// DISPATCH STOCK
// ==========================================================

app.post(
  "/api/stock-out",
  (req, res) => {
    try {
      const {
        product_id,
        destination_id,
        quantity,
        notes,
        user_id,
      } = req.body || {};

      const productId =
        Number(product_id);

      const destinationId =
        Number(destination_id);

      const qty =
        Number(quantity);

      if (
        !productId ||
        !destinationId ||
        !qty ||
        qty <= 0
      ) {
        return res.status(400).json({
          error:
            "Product, destination and a positive quantity are required",
        });
      }

      const product = db
        .prepare(`
          SELECT *
          FROM products
          WHERE id = ?
        `)
        .get(productId);

      if (!product) {
        return res.status(404).json({
          error:
            "Product not found",
        });
      }

      const destination = db
        .prepare(`
          SELECT *
          FROM destinations
          WHERE id = ?
        `)
        .get(
          destinationId
        );

      if (!destination) {
        return res.status(404).json({
          error:
            "Destination not found",
        });
      }

      const totals = db
        .prepare(`
          SELECT

            COALESCE(
              (
                SELECT SUM(quantity)
                FROM stock_in
                WHERE product_id = ?
              ),
              0
            ) AS received,

            COALESCE(
              (
                SELECT SUM(quantity)
                FROM stock_out
                WHERE product_id = ?
              ),
              0
            ) AS dispatched
        `)
        .get(
          productId,
          productId
        );

      const remaining =
        Number(
          totals.received || 0
        ) -
        Number(
          totals.dispatched || 0
        );

      if (qty > remaining) {
        return res.status(400).json({
          error:
            "Insufficient stock",
          remaining,
        });
      }

      const result = db
        .prepare(`
          INSERT INTO stock_out
          (
            product_id,
            destination_id,
            quantity,
            notes,
            user_id
          )
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(
          productId,
          destinationId,
          qty,
          notes || null,
          user_id || null
        );

      const record = db
        .prepare(`
          SELECT *
          FROM stock_out
          WHERE id = ?
        `)
        .get(
          result.lastInsertRowid
        );

      res.status(201).json(
        record
      );
    } catch (err) {
      console.error(
        "Stock-out error:",
        err
      );

      res.status(500).json({
        error: err.message,
      });
    }
  }
);

// ==========================================================
// HISTORY
// ==========================================================

app.get(
  "/api/history",
  (req, res) => {
    try {
      const history = db
        .prepare(`
          SELECT
            'in' AS type,
            si.id,
            si.product_id,
            p.name AS product_name,
            si.quantity,
            si.supplier AS detail,
            si.created_at

          FROM stock_in si

          JOIN products p
            ON p.id = si.product_id

          UNION ALL

          SELECT
            'out' AS type,
            so.id,
            so.product_id,
            p.name AS product_name,
            so.quantity,
            d.name AS detail,
            so.created_at

          FROM stock_out so

          JOIN products p
            ON p.id = so.product_id

          LEFT JOIN destinations d
            ON d.id = so.destination_id

          ORDER BY 7 DESC
        `)
        .all();

      res.json(history);
    } catch (err) {
      console.error(
        "History error:",
        err
      );

      res.status(500).json({
        error: err.message,
      });
    }
  }
);

// ==========================================================
// CATALOGUES - GET
// ==========================================================

app.get(
  "/api/catalogues",
  (req, res) => {
    try {
      const catalogues = db
        .prepare(`
          SELECT
            id,
            filename,
            original_name,
            file_path,
            user_id,
            created_at
          FROM catalogues
          ORDER BY created_at DESC
        `)
        .all();

      res.json(
        catalogues
      );
    } catch (err) {
      console.error(
        "Catalogue list error:",
        err
      );

      res.status(500).json({
        error: err.message,
      });
    }
  }
);

// ==========================================================
// CATALOGUE - UPLOAD
// ==========================================================

app.post(
  "/api/catalogues/upload",
  upload.single("image"),
  (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error:
            "No image was uploaded.",
        });
      }

      const userId =
        req.body?.user_id
          ? Number(
              req.body.user_id
            )
          : null;

      const filePath =
        `/uploads/${req.file.filename}`;

      const result = db
        .prepare(`
          INSERT INTO catalogues
          (
            filename,
            original_name,
            file_path,
            user_id
          )
          VALUES (?, ?, ?, ?)
        `)
        .run(
          req.file.filename,
          req.file.originalname,
          filePath,
          userId || null
        );

      const catalogue = db
        .prepare(`
          SELECT *
          FROM catalogues
          WHERE id = ?
        `)
        .get(
          result.lastInsertRowid
        );

      res.status(201).json({
        message:
          "Catalogue uploaded successfully.",
        catalogue,
      });
    } catch (err) {
      console.error(
        "Catalogue upload error:",
        err
      );

      if (req.file?.path) {
        try {
          fs.unlinkSync(
            req.file.path
          );
        } catch {}
      }

      res.status(500).json({
        error:
          "Catalogue upload failed.",
        details: err.message,
      });
    }
  }
);

// ==========================================================
// CATALOGUE - DELETE
// ==========================================================

app.delete(
  "/api/catalogues/:id",
  (req, res) => {
    try {
      const id =
        Number(req.params.id);

      const catalogue = db
        .prepare(`
          SELECT *
          FROM catalogues
          WHERE id = ?
        `)
        .get(id);

      if (!catalogue) {
        return res.status(404).json({
          error:
            "Catalogue not found.",
        });
      }

      const physicalPath =
        path.join(
          uploadsDir,
          catalogue.filename
        );

      if (
        fs.existsSync(
          physicalPath
        )
      ) {
        fs.unlinkSync(
          physicalPath
        );
      }

      db.prepare(`
        DELETE FROM catalogues
        WHERE id = ?
      `).run(id);

      res.json({
        message:
          "Catalogue deleted successfully.",
      });
    } catch (err) {
      console.error(
        "Catalogue delete error:",
        err
      );

      res.status(500).json({
        error: err.message,
      });
    }
  }
);

// ==========================================================
// SERVE REACT FRONTEND
// ==========================================================
//
// IMPORTANT:
// This comes AFTER all /api routes.
//
// When you run:
//
// npm run build
//
// Vite creates:
//
// frontend/dist
//
// Express will then serve that React application.
// ==========================================================

if (
  fs.existsSync(frontendDist)
) {
  console.log(
    `Frontend build found: ${frontendDist}`
  );

  app.use(
    express.static(
      frontendDist
    )
  );

  // React SPA fallback
  app.get(
    "*",
    (req, res, next) => {
      if (
        req.path.startsWith(
          "/api/"
        ) ||
        req.path.startsWith(
          "/uploads/"
        )
      ) {
        return next();
      }

      res.sendFile(
        path.join(
          frontendDist,
          "index.html"
        )
      );
    }
  );
} else {
  console.log(
    "WARNING: frontend/dist was not found."
  );

  console.log(
    "Run: npm run build"
  );
}

// ==========================================================
// MULTER / SERVER ERROR HANDLER
// ==========================================================

app.use(
  (err, req, res, next) => {
    console.error(
      "Server error:",
      err
    );

    if (
      err instanceof
      multer.MulterError
    ) {
      return res.status(400).json({
        error: err.message,
      });
    }

    if (err) {
      return res.status(400).json({
        error: err.message,
      });
    }

    next();
  }
);

// ==========================================================
// START SERVER
// ==========================================================

app.listen(
  PORT,
  HOST,
  () => {
    console.log("");
    console.log(
      "=============================================="
    );
    console.log(
      "           GE.CO. WAREHOUSE"
    );
    console.log(
      "=============================================="
    );

    console.log(
      `Local:   http://localhost:${PORT}`
    );

    console.log(
      `Network: http://<YOUR-PC-IP>:${PORT}`
    );

    console.log(
      `Frontend: ${
        fs.existsSync(frontendDist)
          ? "READY"
          : "NOT BUILT"
      }`
    );

    console.log(
      `Frontend folder: ${frontendDist}`
    );

    console.log(
      `Upload folder: ${uploadsDir}`
    );

    console.log(
      "Products API: ENABLED"
    );

    console.log(
      "Stock API: ENABLED"
    );

    console.log(
      "History API: ENABLED"
    );

    console.log(
      "Catalogue API: ENABLED"
    );

    console.log(
      "Office network access: ENABLED"
    );

    console.log(
      "=============================================="
    );

    console.log("");
  }
);