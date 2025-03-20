/**
 * Google Cloud Run Function for Document Question Answering.
 */

const express = require('express');
const pdf = require('pdf-parse');
const axios = require('axios');
const { VertexAI } = require('@google-cloud/vertexai');

const app = express();
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


    const prompt = `You are a helpful AI assistant. You have access to the content of two documents, a source document and a target document. Use the information in these documents to answer the following question.
      Source Document Content: ${sourceDocumentContent}
      Target Document Content: ${targetDocumentContent}
      Question: ${question}`;

    console.log(`Sending question to Gemini Flash 2.0: ${question}`);

    const streamingResp = await model.generateContentStream(prompt);
    let answerText = '';
    for await (const chunk of streamingResp.stream) {
        answerText += chunk.text();
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


