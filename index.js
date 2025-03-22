/**
 * Google Cloud Run Function for Document Question Answering.
 */


const express = require('express');
const pdf = require('pdf-parse');
const axios = require('axios');
const { VertexAI } = require('@google-cloud/vertexai');
const cors = require('cors');

const app = express();
// Configure CORS to allow your frontend's origin
const allowedOrigins = [
    'https://f16532ea-7934-49ea-98e0-8f3562d2b8ce.lovableproject.com',
    'https://preview--polisee-ai-multiple-prompts-test.lovable.app/compare-documents',
    'https://tarnglobal.com' // Allow production domain
  ];
  app.use(cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or Postman)
      if (!origin) return callback(null, true);
  
      try {
        const parsedOrigin = new URL(origin);
        const originHost = parsedOrigin.hostname;
        const originProtocol = parsedOrigin.protocol;
  
        // 1. Check exact matches first
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
  
        // 2. Check subdomains and base domains
        const isAllowed = allowedOrigins.some(allowed => {
          // Handle full URLs in allowed list
          const allowedClean = allowed.startsWith('http') 
            ? new URL(allowed).hostname 
            : allowed;
  
          // Split domain parts
          const originParts = originHost.split('.');
          const allowedParts = allowedClean.split('.');
  
          // Check if origin matches or is subdomain
          return (
            originHost === allowedClean || // Exact match
            (
              originParts.slice(-allowedParts.length).join('.') === allowedClean &&
              originProtocol === 'https:' // Force HTTPS for subdomains
            )
          );
        });
  
        if (isAllowed) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      } catch (err) {
        callback(new Error('Invalid origin'));
      }
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
  }));
  
  app.use(express.json());

// Configure Vertex AI
const projectId = process.env.PROJECT_ID || "general-testing-450104";  // Ensure this is set in Cloud Run
const location = process.env.LOCATION || 'us-central1'; // Default location
const modelName = 'gemini-2.0-flash-001';  // Specify the model
const vertexAI = new VertexAI({ project: projectId, location: location });


let sourceDocumentContent = '';
let targetDocumentContent = '';
let sourceDocumentUrl = '';
let targetDocumentUrl = '';

// Function to download and parse a PDF from a URL
async function parsePdfFromUrl(url) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');
    const data = await pdf(buffer);
    return data.text;
  } catch (error) {
    console.error('Error parsing PDF:', error);
    throw new Error(`Failed to parse PDF from ${url}: ${error.message}`);
  }
}

 
/**
 * API Endpoint: /upload-documents
 * Receives source and target PDF document URLs, downloads, and parses them.
 */
app.post('/upload-documents', async (req, res) => {
  try {
    const { source_document_url, target_document_url } = req.body;

    if (!source_document_url || !target_document_url) {
      return res.status(400).json({ error: 'Both source_document_url and target_document_url are required.' });
    }

    console.log(`Downloading and parsing documents from: ${source_document_url} and ${target_document_url}`);

    sourceDocumentContent = await parsePdfFromUrl(source_document_url);
    targetDocumentContent = await parsePdfFromUrl(target_document_url);
    sourceDocumentUrl = source_document_url;
    targetDocumentUrl = target_document_url;


    console.log('Documents parsed successfully.');
    res.status(200).json({ message: 'Documents uploaded and parsed successfully.' });

  } catch (error) {
    console.error('Error during document upload and parsing:', error);
    res.status(500).json({ error: error.message });
  }
});


/**
 * API Endpoint: /answer-question
 * Receives a question, uses Gemini Flash 2.0 to answer it based on the parsed documents.
 */
app.post('/answer-question', async (req, res) => {
  try {
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required.' });
    }

    if (!sourceDocumentContent || !targetDocumentContent) {
      return res.status(400).json({ error: 'Documents have not been uploaded and parsed yet.  Call /upload-documents first.' });
    }

    const model = vertexAI.getGenerativeModel({
        model: modelName,
        generation_config: { maxOutputTokens: 2048 },
        safety_settings: [{category: 'HARM_CATEGORY_DEROGATORY', threshold: 'BLOCK_MEDIUM_AND_ABOVE'}, {category: 'HARM_CATEGORY_TOXICITY', threshold: 'BLOCK_MEDIUM_AND_ABOVE'}, {category: 'HARM_CATEGORY_VIOLENCE', threshold: 'BLOCK_MEDIUM_AND_ABOVE'}, {category: 'HARM_CATEGORY_SEXUAL', threshold: 'BLOCK_MEDIUM_AND_ABOVE'}, {category: 'HARM_CATEGORY_MEDICAL', threshold: 'BLOCK_MEDIUM_AND_ABOVE'}, {category: 'HARM_CATEGORY_DANGEROUS', threshold: 'BLOCK_MEDIUM_AND_ABOVE'}]
    });


    const prompt = `You are a compliance expert joining a new bank. You need to familiarize yourself with the bank's Anti-Money Laundering (AML) policy (source document) and then use it to review and answer a client's AML policy target document. All your output must be nicely formatted.
    Both documents will be from Financial Institutions. The first document will be from the source bank and the second document will be from a target bank who is a client of yours.
    Your job is to Answer the questions like a compliance expert who looks keenly at the policies as tries to find the smallest non-compliant clauses related to the question. Keep you answers concise.
    **The following information is just for your understanding. Do not add it in your response

      Source Document Content: ${sourceDocumentContent}
      Target Document Content: ${targetDocumentContent}
      **
      Question: ${question}`;

    console.log(`Sending question to Gemini Flash 2.0: ${question}`);

    const streamingResp = await model.generateContentStream(prompt);
    let answerText = '';
    for await (const chunk of streamingResp.stream) {
      // Handle potential missing candidates/parts safely
      if (chunk.candidates?.[0]?.content?.parts?.[0]?.text) {
        answerText += chunk.candidates[0].content.parts[0].text;
      }
    }


    console.log(`Answer received from Gemini Flash 2.0: ${answerText}`);

    const responseData = {
      answer: answerText,
      source_document: sourceDocumentUrl,
      target_document: targetDocumentUrl,
      question: question,
    };

    res.status(200).json(responseData);

  } catch (error) {
    console.error('Error during question answering:', error);
    res.status(500).json({ error: `Error answering question: ${error.message}` });
  }
});


// Basic health check endpoint
app.get('/', (req, res) => {
  res.status(200).send('Document Question Answering Service is running.');
});


const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Document Question Answering Service listening on port ${port}`);
});


