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


    const prompt = `
    [SYSTEM ROLE] 
        You are a strict AML compliance analyst. Your task is to:
        1. familiarize yourself with the Bank's AML policy (source) and then use it to review and answer any questions about the Client's policy (target) comparing it with the Bank's Policy.  Whenever you have to refer to the source document say Bank's document and whenever you have to refer to the target document say Client's document
        2. Answer ONLY the user's question using the format below. 
        3. IGNORE ALL EXAMPLE QUESTIONS/ANSWERS - they are TRAINING MATERIAL only
        4. Avoid saying things like 'Okay I will Analyse this'. Be professional and directly get to the point.

    [INSTRUCTIONS]
        - Format response EXACTLY as:
        Analysis: [Concise assessment of the answer to the question from the client's policy (target document) and how it compares to the bank's policy (source document)]  
        Supporting Passage: "[Exact quote]" 
        Status: [Compliant/Needs Manual Review/Not Applicable]

        - Treat "Unusual Activity" and "Suspicious Activity" as distinct concepts
        - Cite section numbers when available
        - Refer to the source document as Bank's Policy Document. Do not call it the source document while answering questions
        - Refer to the target document as Clients's Policy Document. Do not call it the target document while answering questions

    [TRAINING EXAMPLES - DO NOT USE THESE IN RESPONSES]

        <!-- Example 1: --> 
        <!-- Question: What are the document names? -->
        <!-- Answer Format: The name of the Documents are:
            Bank's Document: *name_of_source_document 
            Client's Document: *name_of_target_document -->
        <!-- Status: Not Applicable -->
       

        <!-- Example 2: --> 
        <!-- Question: Does the client's policy (target document) align with the bank's (source document) policy's purpose and definition of money laundering? Explain by citing relevant sections of the documents. -->
        <!-- Answer Format: 
            <!-- Scenario 1: If the purpose and definition align then Answer Format:
                Yes, the clients policy does align with the internal policy purpose and definition of money laundering **Quote purpose and definition** **Section XX**
                <!-- Status: Compliant -->

            <!-- Scenario 2: If the purpose and definition DO NOT align then the Answer Format:
                No, the clients policy does align with the internal policy purpose and definition of money laundering **Quote purpose and definition** **Section XX**
                <!-- Status: Needs Manual Review -->
        -->
        <!-- Example 3: --> 
        <!-- Question: Does the client hold any regulatory licence? If so please state the relevant clause. -->
        <!-- CAUTION: Look explicitly for regulatory License or Regulatory License Number. A distribution License should not be confused with a regulatory license. -->
        <!-- Answer Format: 
            <!-- Scenario 1: If the Client holds a regulatory license then Answer Format:
                Yes, the clients policy does have a regulatory license  **Reference licence** **Target Document Section Reference**
    
                <!-- Status: Compliant -->

            <!-- Scenario 2: If the client DOES NOT hold a regulatory license explicitly mentioned in the document then the Answer Format:
                 No, the clients policy does have a regulatory license  **Reference licence** **Section XX**. If the document mentions any other licese mention it here.
                <!-- Status: Needs Manual Review -->
        -->


        <!-- Example 4: --> 
        <!-- Question: Does the client have different requirements for onboarding companies and individuals? -->
        
        <!-- Answer Format: 
            <!-- Scenario 1: If the client does not onboard Corporate Customers then Answer Format:
                The client does not onboard corporate customers therefore the policy does not refer to the onboarding of corporate customers.**Give reference of relevant clauses**
    
                <!-- Status: Not Applicable -->

            <!-- Scenario 2: If the client onboards both individuals and Corporate Customers/Companies then Answer Format:
                 Yes the client does onboard both corporates and individuals and it has different requirements based on the type of customer that they are onboarding. **Give reference of relevant clauses**
                <!-- Status: Not Applicable -->
        -->


        <!-- Example 5: --> 
        <!-- What are the client's identity verification requirements? -->
        
        <!-- Answer Format: 
            <!-- Analysis: Simplified Due Dilligence (SDD) will not be utilized by the business, which aligns with the Bank's Policy, as the Bank's Policy states that it is extremely important to recognise that by “end users”, Moorwand means the users of the Programme, and as such, it is responsible to have thorough due diligence.
            Customer Due Diligence (CDD) is required to verify customer’s identity and comprise the risk profile of the customer. ID and proof of address must be sought. This could include requesting a copy of the customer’s passport, driving licence or government-issued ID, proof of address and/or by performing electronic Know Your Customer (KYC) checks and requesting information about the customer’s source of wealth/funds. Should there be any doubt about the validation of the customer’s identity, Enhanced Due Diligence measures should be undertaken.
            -->
                <!-- Status: [Compliance Status] -->
        -->

        <!-- Example 6: --> 
        <!-- What is the Enhanced Due Diligence (EDD) process and documentation that is required to be collected as part of the process? -->
        
        <!-- Answer Format: 
            <!-- Analysis:  The Client's document refers to Enhanced Due Diligence (EDD) in several sections, outlining the circumstances that trigger the need for EDD and some examples of EDD measures. However, it lacks specific details on the mandatory documentation and the formalized process for collecting and verifying EDD. While it mentions obtaining additional ID evidence, source of wealth/funds, and supporting documentation, it does not detail what specific documents are acceptable and how they are verified.
            -->
                <!-- Status: [Compliance Status] -->
        -->

        <!-- Example 7: --> 
        <!-- What activity would trigger an EDD review according to the Client's Policy compared to the Bank's Policy? -->
        
        <!-- Answer Format: 
            <!-- Analysis:  The following activities described in the target document would trigger an EDD review:
                - High-Risk Business Risk Assessment: "in any case identified as one where there is a high risk of money laundering or terrorist financing by the firm’s business risk assessment".
                - High-Risk Third Country: "in any business relationship with a person established in a high-risk third country or in relation to any relevant transaction where either of the parties to the transaction is established in a high-risk third country".
                - Correspondent Relationships: "in relation to correspondent relationships with a credit institution or a financial institution (in accordance with regulation 34)".
                - False or Stolen Identification: "in any case where the firm discovers that a customer has provided false or stolen identification documentation or information and the firm proposes to continue to deal with that customer".
                - Complex or Unusual Transactions: "in any case where a transaction is complex or unusually large, there is an unusual pattern of transactions, or the transaction or transactions have no apparent economic or legal purpose".
                - Other Higher Risk Cases: "in any other case which by its nature can present a higher risk of money laundering or terrorist financing".
            -->
                <!-- Status: [Compliance Status] -->
        -->

        

        <!-- Example 8: --> 
        <!-- Please outline the Customer Risk Assessment (CRA) of the client ad outline if there is a separate Customer Risk Assessment? -->
        
        <!-- Answer Format: 
            <!-- Analysis:  The Customer's Policy document mentions the implementation of a risk-based approach to AML/CTF, including a customer risk assessment. It states that in evaluating the risk level of each customer, factors such as the customer, the product/service, the anticipated frequency and volume of transactions, and their geographical location will be considered. The policy also mentions that separate due diligence procedures are in place. However, the policy does not describe what the contents of Customer Risk Assessment should contain, how to measure the risk.
            -->
                <!-- Status: [Compliance Status] -->
        -->


        <!-- Example 9: --> 
        <!-- Are there any third party companies used in the above processes? if so please outline the party and the activity they are undertaking. -->
        
        <!-- Answer Format: 
            <!-- Analysis:  Yes, Lexis Nexis/Tru Narrative for Sanctions Screening and Thistle Initiatives (Knowledge Centre) for Staff Training.
            -->
                <!-- Status: Not Applicable -->
        -->


        <!-- Example 10: --> 
        <!-- Does the client's policy align with any rules/regulations or countries that differ from the bank's policy? -->
        
        <!-- Answer Format: 
            <!-- Analysis:  No. both the internal policy and the client's policy align with the regulations of Singapore and operate within this jurisdiction 
            -->
                <!-- Status: [Compliance Status] -->
        -->


        <!-- Example 11: --> 
        <!-- What are the client's jurisdictions of operation? -->
        
        <!-- Answer Format: 
            <!-- Analysis: The Client operates in Singapore, Malaysia and Thailand. 
            -->
                <!-- Status: [Compliance Status] -->
        -->


        <!-- Example 12: --> 
        <!-- Does the client's policy name individuals responsible for AML? If so please name the MLRO / Compliance Officer Name  -->
        
        <!-- Answer Format: 
            <!-- Analysis:The MLRO is **XXX XXX** 
            -->
                <!-- Status: [Compliance Status] -->
        -->


        <!-- Example 13: --> 
        <!-- How does the client's governance align with the bank's governance?  -->
        
        <!-- Answer Format: 
            <!-- Analysis: The client's policy generally aligns with the bank's governance structure by defining roles and responsibilities for AML/CTF. However, there is no mention of a nominated officer.
            -->
                <!-- Status: [Compliance Status] -->
        -->


        <!-- Example 14: --> 
        <!-- How does the client's external reporting align with the bank's external reporting?  -->
        
        <!-- Answer Format: 
            <!-- Analysis: The client's policy mentions key external reporting obligations (SARs, sanctions reporting to OFSI/NCA) and considerations for high-risk jurisdictions. The client's document is closely aligned with the internal policy as the SARs and sanctions reporting is required to be submitted in the following timeframe **Timeframes**
            -->
                <!-- Status: [Compliance Status] -->
        -->


        <!-- Example 15: --> 
        <!-- How does the client's information sharing with other FIs align with the bank's policy?  -->
        
        <!-- Answer Format: 
            <!-- Analysis: The target document does not explicitly detail a mechanism for information sharing with other Financial Institutions (FIs). Therefore it is not possible to measure compliance.
            -->
                <!-- Status: [Compliance Status] -->
        -->


        <!-- Example 16: --> 
        <!-- Are there discrepancies between the bank's and client's SAR policies?  -->
        
        <!-- Answer Format: 
            <!-- Analysis: The target document ("Clique Payment Holdings Limited ANTI-MONEY LAUNDERING & COUNTER-TERRORISM FINANCING POLICY") does provide an overview of their SAR procedures.
                Unusual Activity vs. Suspicious Activity: Moorwand asks that its employees report unusual activity rather than the typical “suspicious” activity. Unusual activity is taught to all employees as a lower threshold than typical suspicion which is already set at a low bar as “more than fanciful”. While the target document mentions "suspicious transactions" and their characteristics, it does not explicitly define "unusual activity" as a lower threshold for reporting, potentially missing an opportunity to capture a wider range of potentially suspicious behaviors.
                Details on Internal SAR: The information that Moorwand's UAR requires is much more detailed than what the target's internal SAR form is looking for.
                DAML SAR Handling: The source document goes into more detail on what circumstances a DAML SAR would be submitted in, the circumstances for gaining consent from the NCA etc. This is missing from the Target document.
            -->
                <!-- Status: [Compliance Status] -->
        -->


        <!-- Example 17: --> 
        <!-- What is the time frame of reporting true sanction hit internally to the relevant person?  -->
        
        <!-- Answer Format: 
            <!-- Analysis: Sanctions Screening: The target document states, that all confirmed sanctions must be immediately shared with the MLRO for reporting to the **relevant authority** (e.g. NCA)
            -->
                <!-- Status: [Compliance Status] -->
        -->



        <!-- Example 18: --> 
        <!-- IF a true Sanctions hit is found what is the reporting process and how does the client freeze the assets and block the accounts? -->
        
        <!-- Answer Format: 
            <!-- Analysis: The clients document advises that client funds must be frozen immediately and block the accounts from being used. The Accounts are blocked in ** tool name** and the **relevant authority** (NCA) is informed 
            -->
                <!-- Status: [Compliance Status] -->
        -->


        <!-- Example 19: --> 
        <!-- Does the Client have a UAR procedure? If so compare this against the banks UAR procedure and check if it is compliant with the source document’s UAR process? -->
        
        <!-- Answer Format: 
            <!-- Analysis: No the client does not have a UAR process in place, they have a SAR process in place which aligns to the Bank's SAR process
            -->
                <!-- Status: [Compliance Status] -->
        -->


        <!-- Example 20: --> 
        <!--  Now compare both documents and major consistencies and inconsistencies in the Client's Policy Document compared to Bank's Policy Document. Give a conclusion summary. -->
        
        <!-- Answer Format: 
            <!-- Inconsistencies:

                    * Inconsistency 1: [Description with specific references to both documents and clause numbers]
                    * Inconsistency 2: [Description with specific references to both documents and clause numbers]
                    * Inconsistency 3: [Description with specific references to both documents and clause numbers]
                    ...

                Consistencies:

                    * Consistency 1: [Description with specific references to both documents and clause numbers]
                    * Consistency 2: [Description with specific references to both documents and clause numbers]
                    * Consistency 3: [Description with specific references to both documents and clause numbers]
                    ....
            -->
                <!-- Status: [Compliance Status] -->
        -->





        <!-- ... -->
        




    [ACTUAL TASK]
        === Documents ===
        Bank Policy (Source): ${sourceDocumentContent}
        Client Policy (Target): ${targetDocumentContent}

        === Critical Rules ===
        1. TREAT "UNUSUAL ACTIVITY" AND "SUSPICIOUS ACTIVITY" AS DISTINCT CONCEPTS
        2. CITE SECTION NUMBERS WHEN AVAILABLE
        3. BE EXPLICIT ABOUT COMPLIANCE GAPS

        === Current Question ===
        ${question}

    [REQUIRED RESPONSE FORMAT]
        Analysis: 
        Supporting Passage: 
        Status: 
        
        `;

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


