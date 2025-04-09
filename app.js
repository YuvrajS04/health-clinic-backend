const express = require('express');
const mysql = require('mysql2');
const dotenv = require('dotenv');
const cors = require('cors');
const { Pool } = require('pg'); // For PostgreSQL connection on Heroku

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Use Heroku's provided DATABASE_URL for MySQL or PostgreSQL connection
const dbURL = process.env.DATABASE_URL;

let db;

// Check if we are in a production environment or local
if (dbURL) {
  // If the environment variable DATABASE_URL exists, we are using Heroku's database
  db = mysql.createConnection({
    uri: dbURL,
  });
} else {
  // If we are running locally, use the MySQL connection
  db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
  });
}

db.connect((err) => {
  if (err) {
    console.error('Database connection failed:', err.stack);
    return;
  }
  console.log('Connected to the database.');
  insertDefaultAppointments(); // Run only after DB connects
});

// Sample Route
app.get('/', (req, res) => {
  res.send('Hello from backend!(Please Work)');
});

// Additional Routes
app.get('/appointments/doctor/:doctor_id', (req, res) => {
  const doctorId = req.params.doctor_id;
  const appointmentDate = req.query.date;

  if (!appointmentDate) {
    return res.status(400).json({ message: "Missing appointment date" });
  }

  const query = `
    SELECT a.*, p.name AS patient_name
    FROM Appointment a
    JOIN Patient p ON a.patient_id = p.patient_id
    WHERE a.doctor_id = ? AND a.appointment_date = ?
    ORDER BY a.appointment_time ASC
  `;

  db.query(query, [doctorId, appointmentDate], (err, results) => {
    if (err) {
      console.error("Error fetching appointments:", err);
      return res.status(500).json({ message: "Failed to fetch appointments" });
    }

    res.status(200).json(results);
  });
});

// Booking Appointments Route
app.post('/book-appointment', (req, res) => {
  const { patient_id, doctor_id, appointment_date, appointment_time } = req.body;

  if (!patient_id || !doctor_id || !appointment_date || !appointment_time) {
    return res.status(400).json({ message: "All fields are required" });
  }

  // Check for doctor availability
  const checkAvailabilityQuery = `
    SELECT * FROM Appointment
    WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ?
  `;

  db.query(checkAvailabilityQuery, [doctor_id, appointment_date, appointment_time], (err, results) => {
    if (err) {
      console.error('Error checking doctor availability:', err);
      return res.status(500).json({ message: 'Internal server error' });
    }

    if (results.length > 0) {
      return res.status(400).json({ message: 'Doctor is already booked at this time' });
    }

    // Proceed with booking
    const insertQuery = `
      INSERT INTO Appointment (patient_id, doctor_id, appointment_date, appointment_time, status)
      VALUES (?, ?, ?, ?, 'Scheduled')
    `;

    db.query(insertQuery, [patient_id, doctor_id, appointment_date, appointment_time], (err, result) => {
      if (err) {
        console.error("Error booking appointment:", err);
        return res.status(500).json({ message: "Failed to book appointment" });
      }
      res.status(201).json({ message: "Appointment booked successfully!" });
    });
  });
});

// Function to insert default appointments only if they don't already exist
const insertDefaultAppointments = () => {
  const appointments = [
    { patient_id: 1, doctor_id: 1, appointment_date: '2025-04-11', appointment_time: '09:00' },
    { patient_id: 2, doctor_id: 1, appointment_date: '2025-04-11', appointment_time: '09:30' },
    { patient_id: 3, doctor_id: 1, appointment_date: '2025-04-11', appointment_time: '10:00' },
    { patient_id: 4, doctor_id: 1, appointment_date: '2025-04-11', appointment_time: '10:30' },
    { patient_id: 5, doctor_id: 1, appointment_date: '2025-04-11', appointment_time: '11:00' }
  ];

  appointments.forEach(appt => {
    const checkQuery = `
      SELECT * FROM Appointment
      WHERE patient_id = ? AND doctor_id = ? AND appointment_date = ? AND appointment_time = ?
    `;
    db.query(checkQuery, [appt.patient_id, appt.doctor_id, appt.appointment_date, appt.appointment_time], (err, results) => {
      if (err) {
        console.error("Error checking if appointment exists:", err);
      }
      if (results.length === 0) {
        const insertQuery = `
          INSERT INTO Appointment (patient_id, doctor_id, appointment_date, appointment_time, status)
          VALUES (?, ?, ?, ?, 'Scheduled')
        `;
        db.query(insertQuery, [appt.patient_id, appt.doctor_id, appt.appointment_date, appt.appointment_time], (err) => {
          if (err) console.error("Error inserting default appointments:", err);
        });
      }
    });
  });
};

// Listen on dynamic port provided by Heroku or port 3000
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
