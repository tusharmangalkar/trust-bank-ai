
import os
import io
import json
import time

from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS

from openai import AzureOpenAI
import requests

# ---- CONVERSATION MEMORY (ALREADY ADDED) ----
from collections import defaultdict
CHAT_HISTORY = defaultdict(list)
MAX_HISTORY = 6
# ---------------------------------------------

# ---- TOPIC TRACKING (NEW ADD) ----
# Keeps the previous question topic so short replies stay in context
LAST_TOPIC = defaultdict(str)
# ----------------------------------

app = Flask(__name__)
@app.route("/")
def home():
    return send_file("chat.html")

@app.route('/<path:filename>')
def serve_static(filename):
    return send_from_directory('.', filename)
CORS(app)
app.config["CORS_HEADERS"] = "Content-Type"

# ========= AZURE CONFIG =========
AZURE_OPENAI_ENDPOINT = "https://rag-open-aaii.openai.azure.com/"
AZURE_OPENAI_KEY = os.getenv("AZURE_OPENAI_KEY")
AZURE_DEPLOYMENT_NAME = "gpt-5-mini"

AZURE_SEARCH_ENDPOINT = "https://ragmod.search.windows.net"
AZURE_SEARCH_KEY = os.getenv("AZURE_SEARCH_KEY")
AZURE_SEARCH_INDEX_NAME = "retail-bank2"

AZURE_TTS_REGION = "eastus"
AZURE_TTS_KEY = os.getenv("AZURE_TTS_KEY")

# ========= OPENAI CLIENT =========

def is_followup_question(question):
    q = question.lower().strip()

    # very short or referential questions
    if len(q.split()) <= 4:
        return True

    # contains pronouns / vague references
    vague_terms = ["this", "that", "it", "these", "those", "same", "above"]
    return any(v in q for v in vague_terms)

def rewrite_followup(question, last_topic):
    r = openai_client.chat.completions.create(
        model=AZURE_DEPLOYMENT_NAME,
        messages=[
            {
                "role": "system",
                "content": (
                    "Rewrite the follow-up banking question into a complete, "
                    "standalone question using the given topic. "
                    "Return ONE sentence only."
                )
            },
            {
                "role": "user",
                "content": f"""
Previous topic:
{last_topic}

Follow-up question:
{question}
"""
            }
        ]
    )
    return r.choices[0].message.content.strip()






try:
    openai_client = AzureOpenAI(
        azure_endpoint=AZURE_OPENAI_ENDPOINT,
        api_key=AZURE_OPENAI_KEY,
        api_version="2024-02-01"
    )
    print("Azure OpenAI client initialized successfully.")
except Exception as e:
    print("OpenAI init failed:", e)
    openai_client = None
  
  
def classify_intent(question):
    q = question.lower()

    return {
        "is_definition": any(p in q for p in [
            "what is", "what does", "meaning of", "explain", "define"
        ]),
        "is_process": any(p in q for p in [
            "how", "steps", "process", "procedure", "flow"
        ]),
        "is_screen": any(p in q for p in [
            "screen", "page", "menu", "where is", "navigation"
        ]),
        "is_comparison": any(p in q for p in [
            "difference", "vs", "compare"
        ])
    }

    
def embed_text(text):
    res = openai_client.embeddings.create(
        model="text-embedding-ada-002",  # DEPLOYMENT NAME
        input=text
    )
    return res.data[0].embedding


# ---- ADMIN RULE CONFIG (ALREADY ADDED) ----
def load_admin_rules():
    try:
        with open("admin_rules.json", "r") as f:
            return json.load(f)
    except:
        return {}

def build_admin_instruction():
    rules = load_admin_rules()
    text = ""

    if rules.get("clarify_first", True):
        text += "- Ask ONE short clarifying question if the user question is unclear.\n"

    if rules.get("always_ask_account_type", True):
        text += "- When question is about opening accounts, ask which type first (Savings/Current/etc.).\n"

    if rules.get("ask_before_steps", True):
        text += "- Confirm user intent before listing long steps.\n"

    if rules.get("tone", "simple") == "simple":
        text += "- Prefer simple, short sentences.\n"

    if rules.get("no_guessing", True):
        text += "- Never guess. If data is missing, say it is unavailable.\n"

    if rules.get("avoid_repetition", True):
        text += "- Avoid unnecessary repetition.\n"

    return text
# -------------------------------------------


# ========= HELPERS =========
def pick_voice(text, lang=None):
    if lang == "hi-IN": return "hi-IN-MadhurNeural","hi-IN"
    if lang == "mr-IN": return "mr-IN-AarohiNeural","mr-IN"
    if lang == "ta-IN": return "ta-IN-ValluvarNeural","ta-IN"
    if lang == "te-IN": return "te-IN-ShrutiNeural","te-IN"
    if lang == "kn-IN": return "kn-IN-GaganNeural","kn-IN"
    if lang == "bn-IN": return "bn-IN-BashkarNeural","bn-IN"
    if lang == "en-IN": return "en-IN-NeerjaNeural","en-IN"
    return "en-IN-NeerjaNeural","en-IN"

def make_no_answer_message(lang):
    if lang == "hi-IN":
        return "क्षमा कीजिए, यह जानकारी हमारे प्री-इंडेक्स्ड दस्तावेज़ों में उपलब्ध नहीं है."
    if lang == "mr-IN":
        return "क्षमस्व — ही माहिती आमच्या प्री-इंडेक्स्ड डॉक्युमेंट्समध्ये उपलब्ध नाही."
    if lang == "ta-IN":
        return "மன்னிக்கவும் — இந்தத் தகவல் எங்கள் ஆவணங்களில் இல்லை."
    if lang == "te-IN":
        return "క్షమించండి — ఈ సమాచారం మా పత్రాల్లో అందుబాటులో లేదు."
    if lang == "kn-IN":
        return "ಕ್ಷಮಿಸಿ — ಈ ಮಾಹಿತಿ ದಾಖಲೆಗಳಲ್ಲಿ ಲಭ್ಯವಿಲ್ಲ."
    if lang == "bn-IN":
        return "দুঃখিত — এই তথ্য নথিগুলিতে পাওয়া যায়নি।"
    return "Sorry — no matching information was found in indexed documents."


def translate_to_english_query(question, lang):
    if lang not in ("hi-IN","mr-IN","ta-IN","te-IN","kn-IN","bn-IN"):
        return question
    if openai_client is None:
        return question

    try:
        r = openai_client.chat.completions.create(
            model=AZURE_DEPLOYMENT_NAME,
            messages=[
                {"role":"system","content":"Translate the banking question into a short English search query. Output ONLY the translation."},
                {"role":"user","content":question}
            ]
        )
        return r.choices[0].message.content.strip()
    except:
        return question

                                           
def translate_answer_to_user_lang(answer, lang):
    if lang == "en-IN" or not answer:
        return answer

    try:
        r = openai_client.chat.completions.create(
            model=AZURE_DEPLOYMENT_NAME,
            messages=[
                {
                    "role": "system",
                    "content": f"""
Translate the following banking answer fully into {lang}.
Translate ALL terms.
Do NOT keep English words.
Use clear, professional banking language.
"""
                },
                {"role": "user", "content": answer}
            ]
        )
        return r.choices[0].message.content.strip()
    except Exception as e:
        print("Translation failed:", e)
        return answer

def normalize_search_query(query, intent):
    q = query.lower()

    # remove question words for definition intent
    if intent.get("is_definition"):
        for w in ["what is", "what does", "define", "meaning of", "?"]:
            q = q.replace(w, "")

    # clean noise
    q = q.replace("?", "").strip()

    return q


def plan_search_query(user_question):
    r = openai_client.chat.completions.create(
        model=AZURE_DEPLOYMENT_NAME,
        messages=[
            {
                "role": "system",
                "content": (
                    "You generate search queries ONLY.\n"
                    "Return STRICT JSON only. No explanation.\n\n"
                    "Schema:\n"
                    "{ \"queries\": [string, string, string] }"
                )
            },
            {"role": "user", "content": user_question}
        ]
    )

    raw = r.choices[0].message.content.strip()

    try:
        return json.loads(raw)
    except Exception:
        print("❌ QUERY PLANNER JSON ERROR:", raw)
        return {"queries": [user_question]}
    



def extract_core_term(question):
        q = question.lower()
        for w in ["what is", "what does", "define", "meaning of", "explain"]:
            q = q.replace(w, "")
        return q.replace("?", "").strip()






def detect_section_from_question(question, search_url, headers):
    """
    Dynamically detects the most relevant section from indexed documents.
    Works for ANY PDF.
    """
    body = {
        "search": question,
        "searchFields": "section",
        "select": "section",
        "top": 5
    }


    try:
        res = requests.post(search_url, headers=headers, json=body)
        hits = res.json().get("value", [])
    except Exception:
        return None

    freq = {}
    for h in hits:
        s = h.get("section")
        if s:
            freq[s] = freq.get(s, 0) + 1

    if not freq:
        return None

    # return most frequent section
    return max(freq, key=freq.get)


# ========= MAIN RAG ENDPOINT =========
@app.route("/ask_question", methods=["POST"])
def ask_question():
    data = request.json or {}
    question = (data.get("question") or "").strip()
    lang = (data.get("lang") or "").strip()

    if not question:
        return jsonify({"error":"Please enter a question"}),400

    # ---- READ CHAT MEMORY ----
    user_id = request.remote_addr or "default_user"
    history = CHAT_HISTORY[user_id][-MAX_HISTORY:]
    # --------------------------

    # ---- SHORT REPLY TOPIC FIX (NEW) ----
    short_replies = ["yes","no","other","savings","current","continue"]

    if is_followup_question(question) and LAST_TOPIC[user_id]:
        question = rewrite_followup(question, LAST_TOPIC[user_id])
    else:
        LAST_TOPIC[user_id] = question

    # -------------------------------------
    english_query = translate_to_english_query(question, lang).strip()
    intent = classify_intent(english_query)
    core_term = extract_core_term(english_query)

 


    search_url = f"{AZURE_SEARCH_ENDPOINT}/indexes/{AZURE_SEARCH_INDEX_NAME}/docs/search?api-version=2023-11-01"
    headers = {
        "Content-Type": "application/json",
        "api-key": AZURE_SEARCH_KEY
    }

    detected_section = detect_section_from_question(
    english_query,
    search_url,
    headers
)

    # 🔒 SMART GLOBAL SEARCH (NO HARD-CODING)

    if intent["is_process"] and LAST_TOPIC[user_id]:
        search_text = LAST_TOPIC[user_id]
    else:
        search_text = core_term

    query_embedding = embed_text(english_query)

    body = {
        "search": search_text,   # BM25 keyword search
        "searchFields": "content,subsection,section",

        "vectorQueries": [
            {
                "vector": query_embedding,
                "fields": "contentVector",
                "k": 8
            }
        ],

        "select": "content,pdf_name,page,section,subsection",
        "top": 8,
        "searchMode": "any"
    }


    # 🔐 OPTIONAL: section narrowing only for PROCESS
    if intent["is_process"] and detected_section:
        body["filter"] = f"section eq '{detected_section}'"

    res = requests.post(search_url, headers=headers, json=body)
    results = res.json().get("value", [])

    # 🚫 STRICT NO-ANSWER RULE
    if not results:
        return jsonify({
            "answer": make_no_answer_message(lang),
            "references": []
        })



  

    system_prompt = f"""
You are a banking documentation assistant for NBFC systems.

You MUST answer strictly using the provided document context.
You are NOT allowed to use external knowledge or assumptions.

========================
ABSOLUTE RULES
========================

1) SOURCE OF TRUTH
- Use ONLY the retrieved document text.
- Do NOT invent, assume, or add information.
- If the answer is not present in the context, clearly say it is unavailable.

2) INTENT UNDERSTANDING
- Understand user intent even if the wording is informal or incomplete.
- Do NOT rely on exact keywords.
- Treat short replies (yes / no / continue / savings / current / other) as continuation of the previous topic.

3) CLARIFICATION
- Ask at most ONE short clarification question ONLY if the intent is genuinely unclear.
- Never repeat the same clarification.
- If intent becomes clear, proceed without asking again.

4) DEFINITIONS / “WHAT IS” QUESTIONS (VERY IMPORTANT)
If the user asks:
- “what is”
- “define”
- “meaning of”
- “what does X mean”

Then:
- If the context contains a description, purpose, usage, or role of the concept,
  → Rewrite that information into ONE clear definition sentence.
- You MAY rephrase procedural or descriptive text into a definition,
  but ONLY using information explicitly present in the context.
- Do NOT add new facts or interpretations.
- If the concept is not mentioned anywhere in the context, say it is unavailable.

5) PROCESS / STEPS QUESTIONS
- Provide steps ONLY if they exist in the context.
- Use bullet points.
- Do NOT merge steps from multiple sections unless clearly related in the document.

6) SCREEN / NAVIGATION QUESTIONS
- Explain based on screen layout or navigation text from the documents.
- Do NOT guess UI behavior beyond what is described.

7) TOPIC CONTINUITY
- Stay within the same topic unless the user clearly switches.
- Do NOT jump to unrelated modules or screens.

8) MISSING INFORMATION
If the documents do not contain the requested information, respond ONLY with:
“Sorry — no matching information was found in indexed documents.”

9) LANGUAGE & STYLE
- Always respond in ENGLISH.
- Use clear, professional banking language.
- Keep answers concise and structured.
- No emojis.
- No self-references (e.g., “as an AI”).
- No repeated content.

10) FORMAT
- Use **bold** for headings.
- Use bullet points for steps.
- One-line definition for definition questions.


11) PAGE NUMBER CITATION
- Mention page number(s) ONLY ONCE at the end of the answer.
- Do NOT repeat page numbers inside sentences or bullet points.



========================
YOUR GOAL
========================

✔ Understand the user’s intent  
✔ Retrieve and use the correct document context  
✔ Rephrase document content when allowed  
✔ Stay strictly grounded in source material  
❌ Never hallucinate  
❌ Never assume  

Answer ONLY based on the provided context.

"""

    messages = [{"role":"system","content":system_prompt}]

    # include past chat
    for h in history:
        messages.append(h)

    
    context_text = ""
    references = []
    seen_refs = set()

    for r in results:
        page = r.get("page", "N/A")
        section = r.get("section", "General")
        pdf = r.get("pdf_name", "Document")

        subsection = r.get("subsection") or section

        context_text += (
            f"[Topic: {subsection}]\n"
            f"{r['content']}\n\n"
        )



        key = (pdf, subsection, page)

        if key not in seen_refs:
            seen_refs.add(key)
            references.append({
            "pdf": pdf,
            "topic": r.get("subsection") or section,
            "page": page
        })


   





    messages.append({
        "role": "user",
        "content": (
            f"Context:\n{context_text}\n\n"
            f"User Intent:\n{json.dumps(intent)}\n\n"
            f"Question:\n{question}\n\n"
            "Answer strictly based on intent and context."
        )
    })

    response = openai_client.chat.completions.create(
        model=AZURE_DEPLOYMENT_NAME,
        messages=messages
    )

    raw_answer = response.choices[0].message.content.strip()
    answer = translate_answer_to_user_lang(raw_answer, lang)


    
# ---- APPEND PAGE REFERENCES (SAFE & CORRECT) ----
    if references:
        pdf_name = references[0]["pdf"]
        topic = references[0]["topic"]
        main_page = references[0].get("page")

        answer += f"\n\n📄 Source: {pdf_name} — {topic} (Page {main_page})"


     # ✅ STORE LAST TOPIC FOR FOLLOW-UP QUESTIONS
    if references:
        LAST_TOPIC[user_id] = references[0]["topic"]



    CHAT_HISTORY[user_id].append({"role":"user","content":question})
    CHAT_HISTORY[user_id].append({"role":"assistant","content":answer})
    

    return jsonify({
        "answer": answer,
        "references": references[:-1],
    })


# ========= TTS =========
def clean_text_for_tts(text):
    import re
    text = re.sub(r"[*#_`]", "", text)
    text = re.sub(r"^\d+\.\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"\s+"," ", text)
    return text.strip()


@app.route("/generate_audio", methods=["POST"])
def generate_audio():
    data = request.json or {}
    raw = (data.get("text") or "").strip()
    lang = (data.get("lang") or "").strip()

    if not raw:
        return jsonify({"error":"No text"}),400

    text = clean_text_for_tts(raw)
    voice, lang_code = pick_voice(text, lang)

    endpoint = f"https://{AZURE_TTS_REGION}.tts.speech.microsoft.com/cognitiveservices/v1"
    headers = {
        "Ocp-Apim-Subscription-Key": AZURE_TTS_KEY,
        "Content-Type":"application/ssml+xml",
        "X-Microsoft-OutputFormat":"audio-16khz-32kbitrate-mono-mp3"
    }

    ssml = f"<speak version='1.0' xml:lang='{lang_code}'><voice name='{voice}'>{text}</voice></speak>"

    r = requests.post(endpoint, headers=headers, data=ssml.encode("utf-8"))

    if r.status_code != 200:
        return jsonify({"error":r.text}),500

    return send_file(io.BytesIO(r.content), mimetype="audio/mp3")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"Server running on port {port}")
    app.run(host="0.0.0.0", port=port)