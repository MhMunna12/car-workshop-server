const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const SSLCommerzPayment = require('sslcommerz-lts');
const store_id = process.env.STORE_ID;
const store_passwd = process.env.STORE_PASS;
const is_live = false;
const app = express();
const port = process.env.PORT || 5000;

console.log();

//middleware
app.use(cors());
app.use(express.json());


//mongodb
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.nwuix.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const verifyToken = (req, res, next) => {
    const authorization = req.headers.authorization;
    // console.log('authorization', authorization);
    if (!authorization) {
        return res.status(401).send({ error: true, message: 'Invalid authorization' })
    }
    const token = authorization.split(' ')[1];
    // console.log('token', token);
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (error, decoded) => {
        if (error) {
            return res.status(403).send({ error: true, message: 'Invalid authorization' })
        }
        req.decoded = decoded;
        next();
    })
}

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const serviceCollection = client.db('Carworkshop').collection('Services')
        const bookingCollection = client.db('Carworkshop').collection('booking')

        //JWT
        app.post('/jwt', (req, res) => {
            const user = req.body;
            // console.log(user);
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
                expiresIn: '1h'
            });
            res.send({ token });
        })

        //SERVICE ROUTES
        app.get('/services', async (req, res) => {
            const search = req.query.search;
            const query = {
                title: { $regex: search, $options: 'i' }
            };
            const options = {
                sort: { 'price': 1 }
            };
            const cursor = serviceCollection.find(query, options);
            const result = await cursor.toArray();
            res.send(result);
        })



        app.get('/services/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await serviceCollection.findOne(query);
            res.send(result);
        })
        app.get('/services/:id', async (req, res) => {
            const id = req.params.id;
            // console.log(id);
            const query = { _id: new ObjectId(id) }
            const options = {
                projection: { title: 1, price: 1, service_id: 1, img: 1 }
            }
            const result = await serviceCollection.findOne(query, options);
            res.send(result);
        })
        //booking
        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const bookingService = await serviceCollection.findOne({ _id: new ObjectId(booking.service_id) });
            console.log(bookingService);
            const transactionId = new ObjectId().toString()
            const data = {
                total_amount: bookingService.price,
                currency: booking.currency,
                tran_id: transactionId, // use unique tran_id for each api call
                success_url: `http://localhost:5000/payment/success?transactionId=${transactionId}`,
                fail_url: `http://localhost:5000/payment/fail?transactionId=${transactionId}`,
                cancel_url: 'http://localhost:5000/payment/cancel',
                ipn_url: 'http://localhost:3030/ipn',
                shipping_method: 'Courier',
                product_name: booking.service,
                product_category: 'Electronic',
                product_profile: 'general',
                cus_name: booking.customerName,
                cus_email: booking.email,
                cus_add1: booking.message,
                cus_add2: 'Dhaka',
                cus_city: 'Dhaka',
                cus_state: 'Dhaka',
                cus_postcode: '1000',
                cus_country: 'Bangladesh',
                cus_phone: booking.phone,
                cus_fax: '01711111111',
                ship_name: 'Customer Name',
                ship_add1: 'Dhaka',
                ship_add2: 'Dhaka',
                ship_city: 'Dhaka',
                ship_state: 'Dhaka',
                ship_postcode: booking.postCode,
                ship_country: 'Bangladesh',
            };

            const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live)
            sslcz.init(data).then(apiResponse => {
                // Redirect the user to payment gateway
                let GatewayPageURL = apiResponse.GatewayPageURL
                bookingCollection.insertOne({
                    ...booking,
                    price: bookingService.price,
                    transactionId,
                    paid: false
                })
                res.send({ url: GatewayPageURL })
                // console.log('Redirecting to: ', GatewayPageURL)
            });
        })

        app.get('/booking/by-transaction-id/:id', async (req, res) => {
            const { id } = req.params;
            const booking = await bookingCollection.findOne({ transactionId: id })
            res.send(booking)
        })
        app.post('/payment/success', async (req, res) => {
            const { transactionId } = req.query;
            if (!transactionId) {
                return res.redirect(`http://localhost:5173/payment/fail?transactionId=${transactionId}`)
            }
            const result = await bookingCollection.updateOne({ transactionId }, { $set: { paid: true, paidAt: new Date() } })
            if (result.modifiedCount > 0) {
                res.redirect(`http://localhost:5173/payment/success?transactionId=${transactionId}`)
            }
        })
        app.post('/payment/fail', async (req, res) => {
            const { transactionId } = req.query;
            if (!transactionId) {
                return res.redirect(`http://localhost:5173/payment/fail?transactionId=${transactionId}`)
            }
            const result = await bookingCollection.deleteOne({ transactionId })
            if (result.deletedCount) {
                res.redirect(`http://localhost:5173/payment/fail?transactionId=${transactionId}`)
            }
        })
        // app.get('/booking', async (req, res) => {
        //     const result = await bookingCollection.find().toArray();
        //     res.send(result)
        // })
        app.get('/booking', verifyToken, async (req, res) => {
            const decoded = req.decoded;
            // console.log('come back', decoded);
            if (decoded.email !== req.query.email) {
                return res.status(403).res.send({ error: true, message: 'forbidden access' })
            }
            let query = {};
            if (req.query?.email) {
                query = { email: req.query.email }
            }
            const result = await bookingCollection.find(query).toArray();
            res.send(result)
        })


        //update
        app.patch('/booking/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) }
            const updateBooking = req.body;
            console.log(updateBooking);
            const updateDoc = {
                $set: {
                    status: updateBooking.status
                }
            }
            const result = await bookingCollection.updateOne(filter, updateDoc);
            res.send(result);
        })

        //delete
        app.delete('/booking/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await bookingCollection.deleteOne(query);
            res.send(result);
        })

        //

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Car WorkShop')
})

app.listen(port, () => {
    console.log(`car workshop server is running on port ${port}`);
})