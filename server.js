const express = require('express');
const cors = require('cors');
const pool = require('./db');
const fs = require('fs'); // Node's built-in file system module for file cleanup
const multer = require('multer'); // For handling file uploads
const path = require('path'); // Node's built-in path module
const app = express();
const PORT = 3000;

// ----------------------------------------------------
// Multer Setup: Configure where to save uploaded files
// ----------------------------------------------------
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Saves files to the 'uploads' folder
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        // Creates a unique filename: bill_number-style-TIMESTAMP.ext
        const billNumber = req.body.bill_number || 'temp';
        const fileExtension = path.extname(file.originalname);
        cb(null, billNumber + '-style-' + Date.now() + fileExtension);
    }
});
const upload = multer({ storage: storage });

// Middleware Setup
app.use(express.json());
app.use(cors());
// Tell Express to serve files from the 'uploads' folder publicly
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- Simple Test Route (GET /) ---
app.get('/', (req, res) => {
    res.send('Tailor Shop API is running!');
});

// ----------------------------------------------------------------------
// A. POST Route: Create a New Order (Handles File Upload)
// ----------------------------------------------------------------------
// Uses upload.single('style_image') to process the file input named 'style_image'
app.post('/api/orders', upload.single('style_image'), async (req, res) => {
    // Data comes from req.body (form fields) and req.file (file info)
    const { bill_number, delivery_date, notes } = req.body;
    const bill_date = new Date().toISOString().split('T')[0];
    const image_path = req.file ? req.file.filename : null; // Get filename from multer

    if (!bill_number || !delivery_date) {
        // Clean up the uploaded file if validation fails
        if (req.file) {
            fs.unlink(req.file.path, (err) => { 
                if (err) console.error("Failed to delete file:", err); 
            });
        }
        return res.status(400).json({ error: 'Bill number and delivery date are required.' });
    }

    try {
        const query = `
            INSERT INTO Orders (bill_number, bill_date, delivery_date, notes, status, customer_name, total_amount, image_path)
            VALUES (?, ?, ?, ?, 'Pending', 'N/A', 0.00, ?)
        `;
        
        const [result] = await pool.execute(query, [
            bill_number, 
            bill_date, 
            delivery_date, 
            notes || '', // Ensures empty notes are saved as an empty string, not null
            image_path 
        ]);
        
        if (result.affectedRows === 0) {
            return res.status(409).json({ error: 'Bill number already exists or failed to insert.' });
        }

        res.status(201).json({ 
            message: 'Order created successfully.', 
            bill_number: bill_number 
        });

    } catch (err) {
        // Clean up the uploaded file if database insertion fails
        if (req.file) {
            fs.unlink(req.file.path, (err) => { 
                if (err) console.error("Failed to delete file after DB error:", err); 
            });
        }
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Bill number already exists. Please use a unique number.' });
        }
        console.error("Error creating order:", err);
        res.status(500).json({ error: 'Failed to create order.' });
    }
});

// ----------------------------------------------------------------------
// --- B. PUT Route: Mark Order as Complete ---
// ----------------------------------------------------------------------
app.put('/api/orders/:billNumber/complete', async (req, res) => {
    const { billNumber } = req.params;

    try {
        const query = `
            UPDATE Orders 
            SET status = 'Complete', completion_date = NOW() 
            WHERE bill_number = ? AND status != 'Complete'
        `;
        const [result] = await pool.execute(query, [billNumber]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Order not found or status not updated.' });
        }
        
        res.json({ message: `Bill ${billNumber} marked as Complete and ready for pickup.` });
    } catch (err) {
        console.error("Error completing order:", err);
        res.status(500).json({ error: 'Failed to update order status.' });
    }
});

// ----------------------------------------------------------------------
// --- C. GET Route: Display Pending Bills (Tailor's Main View) ---
// ----------------------------------------------------------------------
app.get('/api/orders/pending', async (req, res) => {
    const start_date = req.query.start_date || '2000-01-01'; 
    const end_date = req.query.end_date || '2100-01-01';

    try {
        const query = `
            SELECT bill_number, delivery_date, notes, status, image_path
            FROM Orders 
            WHERE status IN ('Pending', 'In Progress') 
            AND delivery_date BETWEEN ? AND ? 
            ORDER BY delivery_date ASC
        `;
        // Removed customer_name and total_amount from SELECT list as they are no longer needed
        const [rows] = await pool.execute(query, [start_date, end_date]);
        res.json(rows);
    } catch (err) {
        console.error("Error fetching pending orders:", err);
        res.status(500).json({ error: 'Error fetching pending orders.' });
    }
});

// ----------------------------------------------------------------------
// --- D. GET Route: Get ALL Orders (For Reports/History and Completed Tab) ---
// ----------------------------------------------------------------------
app.get('/api/orders', async (req, res) => {
    try {
        const query = `
            SELECT bill_number, delivery_date, notes, status, completion_date, image_path
            FROM Orders 
            ORDER BY bill_number DESC
        `;
        // Removed unnecessary fields from SELECT list
        const [rows] = await pool.execute(query);
        res.json(rows);
    } catch (err) {
        console.error("Error fetching all orders:", err);
        res.status(500).json({ error: 'Error fetching all orders.' });
    }
});

// Start the server
// NOTE: Make sure the connection to the database (pool) is established before starting the listener
pool.getConnection()
    .then(connection => {
        console.log("✅ SUCCESSFULLY CONNECTED to MySQL Database!");
        connection.release();
        app.listen(PORT, () => {
            console.log(`Server is running on http://localhost:${PORT}`);
        });
    })
    .catch(err => {
        console.error("❌ FAILED TO CONNECT to MySQL Database:", err.message);
    });