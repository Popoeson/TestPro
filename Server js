const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Environment Variables
const PORT = process.env.PORT || 5000;
const MONGO_URI = process.env.MONGO_URI;
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

// MongoDB Schema
const transactionSchema = new mongoose.Schema({
  email: String,
  amount: Number,
  reference: String,
  status: { type: String, default: 'pending' },
  createdAt: { type: Date, default: Date.now },
});

const Transaction = mongoose.model('Transaction', transactionSchema);

// Token Schema
const tokenSchema = new mongoose.Schema({
  studentName: String,
  studentEmail: String,
  amount: Number,
  reference: String,
  token: String,
  status: {
    type: String,
    enum: ['pending', 'success', 'used'],
    default: 'pending',
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const Token = mongoose.model('Token', tokenSchema);

// Connect to MongoDB
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection failed:", err));

// ✅ Route to create a reusable Paystack split code
app.post('/api/split/create', async (req, res) => {
  try {
    const response = await axios.post(
      'https://api.paystack.co/split',
      {
        name: 'CBT Token Split Group',
        type: 'percentage',
        currency: 'NGN',
        subaccounts: [
          {
            subaccount: 'ACCT_pm10n7jnq0ov8e5',
            share: 70
          }
        ],
        bearer_type: 'subaccount', // ✅ Subaccount pays Paystack fee
        bearer_subaccount: 'ACCT_pm10n7jnq0ov8e5' // ✅ Fee is charged to this subaccount
      },
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.json({
      message: '✅ Split group created successfully',
      split_code: response.data.data.split_code,
      full_data: response.data.data
    });
  } catch (error) {
    console.error("❌ Split creation error:", error.response?.data || error.message);
    return res.status(500).json({
      error: 'Failed to create split group',
      details: error.response?.data || error.message
    });
  } 
});

// ✅ Initialize payment for Paystack popup (NO callback_url)
app.post('/api/payment/initialize', async (req, res) => {
  const { email, amount } = req.body;

  try {
    const response = await axios.post('https://api.paystack.co/transaction/initialize', {
      email,
      amount: amount * 100,
      split_code: 'SPL_Ign6KoMszo'
    }, {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    const { authorization_url, reference } = response.data.data;

    await Transaction.create({ email, amount, reference });
    res.json({ authorization_url, reference });
  } catch (error) {
    console.error("Init error:", error.response?.data || error.message);
    res.status(500).json({ error: 'Payment initialization failed' });
  }
});

// ✅ Verify payment and generate token
app.get('/api/payment/verify/:reference', async (req, res) => {
  const { reference } = req.params;

  try {
    const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${PAYSTACK_SECRET_KEY}` },
    });

    const status = response.data.data.status;

    const transaction = await Transaction.findOneAndUpdate(
      { reference },
      { status },
      { new: true }
    );

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    if (status === 'success') {
      const existingToken = await Token.findOne({ reference });
      if (existingToken) {
        return res.json({
          message: 'Payment already verified, token exists',
          token: existingToken.token,
          transaction,
        });
      }

      const tokenCode = 'CBT-' + Math.floor(100000 + Math.random() * 900000);

      const newToken = new Token({
        token: tokenCode,
        studentEmail: transaction.email,
        amount: transaction.amount,
        reference,
        status: 'success',
        createdAt: new Date()
      });

      await newToken.save();

      return res.json({
        message: 'Payment verified and token issued',
        token: tokenCode,
        transaction,
      });
    } else {
      return res.status(400).json({ message: 'Payment not successful', status });
    }
  } catch (error) {
    console.error("Verify error:", error.message);
    return res.status(500).json({ error: 'Payment verification failed' });
  }
});

// ✅ Save transaction manually
app.post('/api/transactions/save', async (req, res) => {
  const { email, amount, reference } = req.body;

  try {
    const existing = await Transaction.findOne({ reference });
    if (!existing) {
      await Transaction.create({ email, amount, reference });
    }
    res.json({ message: 'Transaction saved' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to save transaction' });
  }
});

// ✅ Get all tokens
app.get('/api/tokens', async (req, res) => {
  try {
    const tokens = await Token.find().sort({ createdAt: -1 });
    res.json(tokens);
  } catch (err) {
    res.status(500).json({ message: "Error fetching tokens" });
  }
});

// ✅ Validate token route
app.get('/api/tokens/validate/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const found = await Token.findOne({ token });

    if (!found) {
      return res.status(404).json({ valid: false, message: "Token not found." });
    }

    if (found.status !== 'success') {
      return res.status(400).json({ valid: false, message: "Token is not valid or already used." });
    }

    return res.json({ valid: true });
  } catch (err) {
    console.error("Token validation error:", err.message);
    res.status(500).json({ valid: false, message: "Server error." });
  }
});

// ✅ Mark token as used
app.patch('/api/tokens/mark-used/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const updated = await Token.findOneAndUpdate(
      { token },
      { status: 'used' },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({ success: false, message: "Token not found" });
    }

    res.json({ success: true, message: "Token marked as used", token: updated });
  } catch (err) {
    console.error("Mark-used error:", err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get('/', (req, res) => {
  res.send("CBT Token Payment API is running");
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
