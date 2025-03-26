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
    'https://id-preview--f16532ea-7934-49ea-98e0-8f3562d2b8ce.lovable.app',
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


    const prompt = `You are a compliance expert joining a new bank. You need to familiarize yourself with the bank's Anti-Money Laundering (AML) policy (source document) and then use it to review and answer a client's AML policy (target document). All your output must be nicely formatted and your responses should sound professional. Avoid saying things like 'Okay I will Analyse this'. Be professional and directly get to the point. Whenever you have to refer to the source document say Bank's document and whenever you have to refer to the target document say Client's document.

    Here are some specific examples of how to analyze and answer questions about the document and provide a compliance status. These questions are just for your understanding don't include them in you analysis of other questions:

    ***Start of examples not to be included in your response.******
    ****Start of section which is only for your learning. This should not be included in your analysis. Including this will make your analysis invalid.*****

    Example 1:

    Question: What are the names of the documents?
    Answer: The name of the Documents are:
    Bank's Document: *name_of_source_document 
    Client's Document: *name_of_target_document*
    Status: Not Applicable

    Example 2:
    Document: [Target Document]
    Does the client's policy (target document) align with the bank's (source document) policy's purpose and definition of money laundering? Explain by citing relevant sections of the documents.
    If the purpose and definition align then the Answer: Yes, the clients policy does align with the internal policy purpose and definition of money laundering **Quote purpose and definition** **Section XX**
    Status: Compliant

    If the purpose and definition DO NOT align then the Answer: No, the clients policy does align with the internal policy purpose and definition of money laundering **Quote purpose and definition** **Section XX**
    Status: Needs Manual Review

    Example 3:
    *Does the client hold any regulatory licence? If so please state this
    Important note for this question: If the client holds a regulatory license explicitly mentioned in the document (a distribution license does not count as a regulatory license. We are explicitly looking for a regulatory license. So look explicitly for regulatory licesne number. It has to be regulatory license number no any other license number) 
    Answer: Yes, the clients policy does have a regulatory license  **Reference licence** **Target Document Section Reference**
    Status: Compliant

    If the client DOES NOT hold a regulatory license explicitly mentioned in the document Answer: No, the clients policy does have a regulatory license  **Reference licence** **Section XX**. If the document mentions any other licese mention it here.
    Status: Needs Manual Review

    Example 4: 
    *Does the client have different requirements for onboarding companies and individuals?
    If the client does not onboard Corporate Customers then Answer: **The client does not onboard corporate customers therefore the policy does not refer to the onboarding of corporate customers.**Give reference of relevant clauses** **
    If the client onboards both individuals and Corporate Customers/Companies then Answer: **Yes the client does onboard both corporates and individuals and it has different requirements based on the type of customer that they are onboarding. **Give reference of relevant clauses**

    Example 5:
    * What are the client's identity verification requirements?
    Example Answer: 
    Simplified Due Dilligence (SDD) will not be utilized by the business, which aligns with the source document, as the source document states it is extremely important to recognise that by “end users”, Moorwand means the users of the Programme, and as such, it is responsible to have thorough due diligence.
    Customer Due Diligence (CDD) is required to verify customer’s identity and comprise the risk profile of the customer. ID and proof of address must be sought. This could include requesting a copy of the customer’s passport, driving licence or government-issued ID, proof of address and/or by performing electronic Know Your Customer (KYC) checks and requesting information about the customer’s source of wealth/funds. Should there be any doubt about the validation of the customer’s identity, Enhanced Due Diligence measures should be undertaken.

    Example 6:
    *What is the Enhanced Due Diligence (EDD) process and documentation that is required to be collected as part of the process?
    Example Answer: The target document refers to Enhanced Due Diligence (EDD) in several sections, outlining the circumstances that trigger the need for EDD and some examples of EDD measures. However, it lacks specific details on the mandatory documentation and the formalized process for collecting and verifying EDD. While it mentions obtaining additional ID evidence, source of wealth/funds, and supporting documentation, it does not detail what specific documents are acceptable and how they are verified.

    Example 7: 
    *What activity would trigger an EDD review?
    Example Answer:
    The following activities described in the target document would trigger an EDD review:
    - High-Risk Business Risk Assessment: "in any case identified as one where there is a high risk of money laundering or terrorist financing by the firm’s business risk assessment".
    - High-Risk Third Country: "in any business relationship with a person established in a high-risk third country or in relation to any relevant transaction where either of the parties to the transaction is established in a high-risk third country".
    - Correspondent Relationships: "in relation to correspondent relationships with a credit institution or a financial institution (in accordance with regulation 34)".
    - False or Stolen Identification: "in any case where the firm discovers that a customer has provided false or stolen identification documentation or information and the firm proposes to continue to deal with that customer".
    - Complex or Unusual Transactions: "in any case where a transaction is complex or unusually large, there is an unusual pattern of transactions, or the transaction or transactions have no apparent economic or legal purpose".
    - Other Higher Risk Cases: "in any other case which by its nature can present a higher risk of money laundering or terrorist financing".

    Example 8:

    *Please outline the Customer Risk Assessment (CRA) of the client ad outline if there is a separate Customer Risk Assessment?
    Example Answer: The target document mentions the implementation of a risk-based approach to AML/CTF, including a customer risk assessment. It states that in evaluating the risk level of each customer, factors such as the customer, the product/service, the anticipated frequency and volume of transactions, and their geographical location will be considered. The policy also mentions that separate due diligence procedures are in place. However, the policy does not describe what the contents of Customer Risk Assessment should contain, how to measure the risk.

    Example 9:

    *Are there any third party companies used in the above processes? if so please outline the party and the activity they are undertaking
    Example Answer: Yes, Lexis Nexis/Tru Narrative for Sanctions Screening and Thistle Initiatives (Knowledge Centre) for Staff Training.


    Example 10:

    * Does the client's policy align with any rules/regulations or countries that differ from the bank's policy?
    Example Answer: No. both the internal policy and the client's policy align with the regulations of Singapore and operate within this jurisdiction 

    Example 11:

    * What are the client's jurisdictions of operation?
    Example Answer: The Client operates in Singapore, Malaysia and Thailand

    Example 12:

    * Does the client's policy name individuals responsible for AML? If so please name the MLRO / Compliance Officer Name 
    Example Answer: The MLRO is **XXX XXX** 

    Example 13:
    
    * How does the client's governance align with the bank's governance?
    Example Answer: The client's policy generally aligns with the bank's governance structure by defining roles and responsibilities for AML/CTF. However, there is no mention of a nominated officer.

    Example 14:

    * How does the client's external reporting align with the bank's external reporting?
    Example Answer: The client's policy mentions key external reporting obligations (SARs, sanctions reporting to OFSI/NCA) and considerations for high-risk jurisdictions. The client's document is closely aligned with the internal policy as the SARs and sanctions reporting is required to be submitted in the following timeframe **Timeframes**

    Example 15:

    * How does the client's information sharing with other FIs align with the bank's policy?
    Example Answer: The target document does not explicitly detail a mechanism for information sharing with other Financial Institutions (FIs). Therefore it is not possible to measure compliance.

    Example 16:

    * Are there discrepancies between the bank's and client's SAR policies?
    Example answer: The target document ("Clique Payment Holdings Limited ANTI-MONEY LAUNDERING & COUNTER-TERRORISM FINANCING POLICY") does provide an overview of their SAR procedures.
    Unusual Activity vs. Suspicious Activity: Moorwand asks that its employees report unusual activity rather than the typical “suspicious” activity. Unusual activity is taught to all employees as a lower threshold than typical suspicion which is already set at a low bar as “more than fanciful”. While the target document mentions "suspicious transactions" and their characteristics, it does not explicitly define "unusual activity" as a lower threshold for reporting, potentially missing an opportunity to capture a wider range of potentially suspicious behaviors.
    Details on Internal SAR: The information that Moorwand's UAR requires is much more detailed than what the target's internal SAR form is looking for.
    DAML SAR Handling: The source document goes into more detail on what circumstances a DAML SAR would be submitted in, the circumstances for gaining consent from the NCA etc. This is missing from the Target document.


    Example 17:

    *What is the time frame of reporting true sanction hit internally to the relevant person?
    Example Answer: Sanctions Screening: The target document states, that all confirmed sanctions must be immediately shared with the MLRO for reporting to the **relevant authority** (e.g. NCA)


    Example 18:

    *IF a true Sanctions hit is found what is the reporting process and how does the client freeze the assets and block the accounts?
    Example Answer: The clients document advises that client funds must be frozen immediately and block the accounts from being used. The Accounts are blocked in ** tool name** and the **relevant authority** (NCA) is informed 

    Example 19:

    * Does the Client have a UAR procedure? If so compare this against the banks UAR procedure and check if it is compliant with the source document’s UAR process
    Example Answer: No the client does not have a UAR process in place, they have a SAR process in place which aligns to the internal SAR process






    ****End of section which is only for your learning. This should not be included in your analysis****
    ***End of examples***



    Now Analyze all context and answer based on that
    Source Document Content: ${sourceDocumentContent}
    Target Document Content: ${targetDocumentContent}
    Both documents will be from Financial Institutions. The first document will be from the  bank and the second document will be from a client who is a client of yours. Make sure you know that Unusual Activity and Suspicious Activity are completely different and must not be confused if you find them in the document and are asked about thems. THE Unusual Activity and Suspicious Activity related clauses must be treated differently and separately.
    Your response should be formatted as follows:
    Analysis: [Your analysis of the clause]
    Supporting Passage: [The relevant passage from the document]
    Status: [Compliant/Needs Manual Review/Not Applicable]

    Your job is to Answer the questions like a compliance expert who looks keenly at the policies as tries to find the smallest non-compliant clauses related to the question.
    Follow these points every time:
    1.  Keep your answers concise.
    2.  Cite supporting passages.
    3. Add the final assessment

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


