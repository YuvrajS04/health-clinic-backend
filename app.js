const express = require('express');
const mysql = require('mysql2');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// Create a MySQL connection
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE
});

db.connect(err => {
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
// Get all appointments for a specific doctor on a specific date
app.get('/appointments/doctor/:doctor_id', (req, res) => {
  const doctorId = req.params.doctor_id;
  const appointmentDate = req.query.date; // Format: YYYY-MM-DD

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
// GET all appointments for a specific patient
app.get('/appointments/patient', (req, res) => {
  const { patient_id } = req.query;

  if (!patient_id) {
    return res.status(400).json({ message: "patient_id is required" });
  }

  const query = `
    SELECT a.*, d.name AS doctor_name
    FROM Appointment a
    JOIN Doctor d ON a.doctor_id = d.doctor_id
    WHERE a.patient_id = ?
    ORDER BY a.appointment_date, a.appointment_time
  `;

  db.query(query, [patient_id], (err, results) => {
    if (err) {
      console.error("Error fetching patient appointments:", err);
      return res.status(500).json({ message: 'Error fetching patient appointments' });
    }
    res.json(results);
  });
});
// Helper: Check if appointment_time is a valid 30-minute slot
const isValidTimeSlot = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return minutes === 0 || minutes === 30;
};
app.put('/appointments/:appointment_id', (req, res) => {
  const appointmentId = req.params.appointment_id;
  const { appointment_date, appointment_time, status } = req.body;

  // Validation
  if (!appointment_date || !appointment_time) {
    return res.status(400).json({ message: "Appointment date and time are required" });
  }

  if (!isValidTimeSlot(appointment_time)) {
    return res.status(400).json({ message: "Appointment time must be in 30-minute intervals (e.g., 10:00, 10:30)" });
  }

  // Check if the new slot is already taken for the same doctor
  const checkAvailabilityQuery = `
    SELECT * FROM Appointment
    WHERE doctor_id = (
      SELECT doctor_id FROM Appointment WHERE appointment_id = ?
    )
    AND appointment_date = ? AND appointment_time = ? AND appointment_id != ?
  `;

  db.query(checkAvailabilityQuery, [appointmentId, appointment_date, appointment_time, appointmentId], (err, results) => {
    if (err) {
      console.error("Error checking availability:", err);
      return res.status(500).json({ message: "Server error" });
    }

    if (results.length > 0) {
      return res.status(400).json({ message: "Another appointment already exists at this time" });
    }

    const updateQuery = `
      UPDATE Appointment
      SET appointment_date = ?, appointment_time = ?, status = ?
      WHERE appointment_id = ?
    `;

    db.query(updateQuery, [appointment_date, appointment_time, status || 'Scheduled', appointmentId], (err, result) => {
      if (err) {
        console.error("Error updating appointment:", err);
        return res.status(500).json({ message: "Failed to update appointment" });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Appointment not found" });
      }

      res.status(200).json({ message: "Appointment updated successfully" });
    });
  });
});



// Create an appointment (Patient books an appointment)
app.post('/book-appointment', (req, res) => {
  const { patient_id, doctor_id, appointment_date, appointment_time } = req.body;

  // Validate input
  if (!patient_id || !doctor_id || !appointment_date || !appointment_time) {
    return res.status(400).json({ message: "All fields are required" });
  }

  // Validate time slot
  if (!isValidTimeSlot(appointment_time)) {
    return res.status(400).json({ message: "Appointment time must be in 30-minute intervals (e.g., 10:00, 10:30)" });
  }

  // Check doctor availability (within the 30-minute window)
  const checkDoctorAvailabilityQuery = `
    SELECT * FROM Appointment
    WHERE doctor_id = ? AND appointment_date = ? AND appointment_time = ?
  `;

  db.query(checkDoctorAvailabilityQuery, [doctor_id, appointment_date, appointment_time], (err, results) => {
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

// DELETE an appointment by ID (admin use only)
app.delete('/appointments/:appointment_id', (req, res) => {
  const appointmentId = req.params.appointment_id;

  const deleteQuery = `
    DELETE FROM Appointment WHERE appointment_id = ?
  `;

  db.query(deleteQuery, [appointmentId], (err, result) => {
    if (err) {
      console.error("Error deleting appointment:", err);
      return res.status(500).json({ message: "Failed to delete appointment" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    res.status(200).json({ message: "Appointment deleted successfully" });
  });
});

// Function to insert default appointments only if they don't already exist
const insertDefaultAppointments = () => {
  const appointments = [
    { patient_id: 1, doctor_id: 1, appointment_date: '2025-04-11', appointment_time: '09:00' },
    { patient_id: 2, doctor_id: 1, appointment_date: '2025-04-11', appointment_time: '09:30' },
    { patient_id: 3, doctor_id: 1, appointment_date: '2025-04-11', appointment_time: '10:00' },
    { patient_id: 4, doctor_id: 1, appointment_date: '2025-04-11', appointment_time: '10:30' },
    { patient_id: 5, doctor_id: 1, appointment_date: '2025-04-11', appointment_time: '11:00' },
    
    { patient_id: 6, doctor_id: 2, appointment_date: '2025-04-11', appointment_time: '09:00' },
    { patient_id: 7, doctor_id: 2, appointment_date: '2025-04-11', appointment_time: '09:30' },
    { patient_id: 8, doctor_id: 2, appointment_date: '2025-04-11', appointment_time: '10:00' },
    { patient_id: 9, doctor_id: 2, appointment_date: '2025-04-11', appointment_time: '10:30' },
    { patient_id: 10, doctor_id: 2, appointment_date: '2025-04-11', appointment_time: '11:00' },

    { patient_id: 1, doctor_id: 3, appointment_date: '2025-04-12', appointment_time: '09:00' },
    { patient_id: 2, doctor_id: 3, appointment_date: '2025-04-12', appointment_time: '09:30' },
    { patient_id: 3, doctor_id: 3, appointment_date: '2025-04-12', appointment_time: '10:00' },
    { patient_id: 4, doctor_id: 3, appointment_date: '2025-04-12', appointment_time: '10:30' },
    { patient_id: 5, doctor_id: 3, appointment_date: '2025-04-12', appointment_time: '11:00' },

    { patient_id: 6, doctor_id: 4, appointment_date: '2025-04-13', appointment_time: '09:00' },
    { patient_id: 7, doctor_id: 4, appointment_date: '2025-04-13', appointment_time: '09:30' },
    { patient_id: 8, doctor_id: 4, appointment_date: '2025-04-13', appointment_time: '10:00' },
    { patient_id: 9, doctor_id: 4, appointment_date: '2025-04-13', appointment_time: '10:30' },
    { patient_id: 10, doctor_id: 4, appointment_date: '2025-04-13', appointment_time: '11:00' },

    { patient_id: 1, doctor_id: 5, appointment_date: '2025-04-14', appointment_time: '09:00' },
    { patient_id: 2, doctor_id: 5, appointment_date: '2025-04-14', appointment_time: '09:30' },
    { patient_id: 3, doctor_id: 5, appointment_date: '2025-04-14', appointment_time: '10:00' },
    { patient_id: 4, doctor_id: 5, appointment_date: '2025-04-14', appointment_time: '10:30' },
    { patient_id: 5, doctor_id: 5, appointment_date: '2025-04-14', appointment_time: '11:00' },

    { patient_id: 6, doctor_id: 1, appointment_date: '2025-04-15', appointment_time: '09:00' },
    { patient_id: 7, doctor_id: 1, appointment_date: '2025-04-15', appointment_time: '09:30' },
    { patient_id: 8, doctor_id: 1, appointment_date: '2025-04-15', appointment_time: '10:00' },
    { patient_id: 9, doctor_id: 1, appointment_date: '2025-04-15', appointment_time: '10:30' },
    { patient_id: 10, doctor_id: 1, appointment_date: '2025-04-15', appointment_time: '11:00' },

    { patient_id: 1, doctor_id: 2, appointment_date: '2025-04-16', appointment_time: '09:00' },
    { patient_id: 2, doctor_id: 2, appointment_date: '2025-04-16', appointment_time: '09:30' },
    { patient_id: 3, doctor_id: 2, appointment_date: '2025-04-16', appointment_time: '10:00' },
    { patient_id: 4, doctor_id: 2, appointment_date: '2025-04-16', appointment_time: '10:30' },
    { patient_id: 5, doctor_id: 2, appointment_date: '2025-04-16', appointment_time: '11:00' },

    { patient_id: 6, doctor_id: 3, appointment_date: '2025-04-17', appointment_time: '09:00' },
    { patient_id: 7, doctor_id: 3, appointment_date: '2025-04-17', appointment_time: '09:30' },
    { patient_id: 8, doctor_id: 3, appointment_date: '2025-04-17', appointment_time: '10:00' },
    { patient_id: 9, doctor_id: 3, appointment_date: '2025-04-17', appointment_time: '10:30' },
    { patient_id: 10, doctor_id: 3, appointment_date: '2025-04-17', appointment_time: '11:00' },

    { patient_id: 1, doctor_id: 4, appointment_date: '2025-04-18', appointment_time: '09:00' },
    { patient_id: 2, doctor_id: 4, appointment_date: '2025-04-18', appointment_time: '09:30' },
    { patient_id: 3, doctor_id: 4, appointment_date: '2025-04-18', appointment_time: '10:00' },
    { patient_id: 4, doctor_id: 4, appointment_date: '2025-04-18', appointment_time: '10:30' },
    { patient_id: 5, doctor_id: 4, appointment_date: '2025-04-18', appointment_time: '11:00' }
  ];

  appointments.forEach(appt => {
    const checkQuery = `
      SELECT * FROM Appointment
      WHERE patient_id = ? AND doctor_id = ? AND appointment_date = ? AND appointment_time = ?
    `;

    db.query(checkQuery, [appt.patient_id, appt.doctor_id, appt.appointment_date, appt.appointment_time], (err, results) => {
      if (err) {
        console.error('Error checking for existing appointment:', err);
      } else if (results.length === 0) {
        const insertQuery = `
          INSERT INTO Appointment (patient_id, doctor_id, appointment_date, appointment_time, status)
          VALUES (?, ?, ?, ?, 'Scheduled')
        `;
        db.query(insertQuery, [appt.patient_id, appt.doctor_id, appt.appointment_date, appt.appointment_time], (err, res) => {
          if (err) {
            console.error('Error inserting appointment:', err);
          } else {
            console.log('Inserted default appointment:', appt);
          }
        });
      } else {
        console.log('Appointment already exists. Skipping:', appt);
      }
    });
  });
};

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
})