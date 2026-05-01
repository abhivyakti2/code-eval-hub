"""
  - Prompts are repo/code-aware.
  - Added separate chains for summary, contributor summary, and questions.
"""

from langchain_groq import ChatGroq
# ChatGroq is a class provided by the langchain_groq library that allows you to interact with the Groq API for natural language processing tasks. It provides methods to send prompts to the Groq API and receive responses, making it easier to integrate Groq's capabilities into your applications. In this code, we create an instance of ChatGroq with specific parameters such as the API key, model name, and temperature for generating responses.
from langchain_core.prompts import PromptTemplate
# PromptTemplate is a class provided by the langchain_core library that allows you to create templates for prompts that can be filled with dynamic content. It helps in structuring the input for language models by defining a template with placeholders for variables. In this code, we use PromptTemplate to define the structure of the prompts that will be sent to the language model, allowing us to easily insert context and questions into the prompts.
from langchain_core.runnables import RunnableParallel, RunnablePassthrough, RunnableLambda
# RunnableParallel, RunnablePassthrough, and RunnableLambda are classes provided by the langchain_core library that allow you to create complex processing pipelines for language models. RunnableParallel allows you to run multiple operations in parallel, RunnablePassthrough simply passes the input through without modification, and RunnableLambda allows you to define custom processing logic using a lambda function. In this code, we use these classes to build chains of operations that retrieve relevant documents, format them, and generate prompts for the language model.
from langchain_core.output_parsers import StrOutputParser
# StrOutputParser is a class provided by the langchain_core library that allows you to parse the output from a language model into a string format. It is used to ensure that the output from the model is in a consistent and expected format, making it easier to work with in subsequent steps of the processing pipeline. In this code, we use StrOutputParser to parse the responses from the language model into strings that can be returned as answers to questions or summaries.
from config import GROQ_API_KEY
# GROQ_API_KEY is a variable that likely contains the API key needed to authenticate with the Groq API. This key is necessary to access the services provided by Groq, such as generating responses from language models. In this code, we import GROQ_API_KEY from a config module, which allows us to keep sensitive information like API keys separate from the main codebase and easily manage it.

llm = ChatGroq(
    groq_api_key=GROQ_API_KEY,
    model_name="llama-3.3-70b-versatile",
    temperature=0.2,
)   # The llm variable is an instance of the ChatGroq class, which is configured to use the Groq API with the specified API key, model name, and temperature. This instance will be used to send prompts to the language model and receive responses based on the defined chains in the code.


def format_docs(docs):
    return "\n\n".join(doc.page_content for doc in docs)
# docs is a list of document objects that are retrieved from the vector store based on their relevance to the query. Each document object has a page_content attribute that contains the text content of the document. The format_docs function takes this list of document objects and formats them into a single string by joining the page_content of each document with two newline characters ("\n\n") in between. This formatted string is then used as context in the prompts sent to the language model.


# ── Chat (RAG Q&A) ─────────────────────────────────────────────
#  TODOs : make temperature for question higher so they're random across users

CHAT_PROMPT = PromptTemplate(
    template="""You are an expert software engineer analysing a GitHub repository.
Answer the question using ONLY the code and files provided below.
If the answer is not in the provided context, say "I don't know based on the available code."

Context (repository files):
{context}

Question: {question}
""",
    input_variables=["context", "question"],
)
#  curly braces in python string are used to indicate placeholders for variables that will be filled in later. In this case, {context} and {question} are placeholders in the template string of the CHAT_PROMPT. When we use this prompt template, we will replace these placeholders with actual values for context and question before sending it to the language model. This allows us to create dynamic prompts that can be customized based on the specific context and question we want to ask about the GitHub repository.
#  """ means it's a multi-line string, which allows us to write the prompt in a more readable format without needing to use newline characters (\n) explicitly. This makes it easier to structure the prompt in a way that is clear and easy to understand, especially when we have multiple lines of text and placeholders for variables.


def build_chat_chain(vector_store):
    retriever = vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 5})
    # The retriever is created from the vector store, which allows us to retrieve relevant documents based on similarity to a query. The search_type "similarity" indicates that we want to retrieve documents that are similar to the input query, and search_kwargs={"k": 5} specifies that we want to retrieve the top 5 most relevant documents. This retriever will be used in the chat chain to fetch relevant context from the repository files when a question is asked.
    #  .as_retriever is a method that converts the vector store into a retriever object that can be used to fetch relevant documents based on a query. 
    parallel = RunnableParallel({
        "context": retriever | RunnableLambda(format_docs),
        "question": RunnablePassthrough(),
    })
    # RunnableParallel is used to run multiple operations in parallel. In this case, we are defining two operations: one for "context" and one for "question". For the "context" operation, we use the retriever to fetch relevant documents based on the input query, and then we format those documents using the format_docs function. For the "question" operation, we simply pass the input question through without modification using RunnablePassthrough. This allows us to prepare both the context and the question simultaneously before sending them to the language model.
    # how does format_docs take the input? if not inside() then how does it know what to format? The format_docs function is used in conjunction with the retriever in the RunnableParallel. When the retriever fetches relevant documents based on the input query, it returns a list of document objects. The RunnableLambda takes this list of document objects as input and applies the format_docs function to it. The format_docs function then processes this list of documents and formats them into a single string that can be used as context for the language model. So, the input to format_docs is the output from the retriever, which is passed through the RunnableLambda in the parallel execution.
    # similarly how does RunnablePassthrough know what to pass through? RunnablePassthrough is designed to simply pass the input it receives through without any modification. In the context of the RunnableParallel, when we define "question": RunnablePassthrough(), it means that whatever input is provided for the "question" key will be passed through as-is. The RunnableParallel will take care of routing the appropriate input to the RunnablePassthrough, so when a question is asked, it will be directly passed through to the next step in the chain without any changes.
    return parallel | CHAT_PROMPT | llm | StrOutputParser()
# | is the operator used to chain together different operations in a sequence. In this case, we are chaining together the parallel execution of retrieving context and passing through the question, then feeding that into the CHAT_PROMPT to generate a prompt for the language model, which is then sent to the llm (language model) for processing, and finally parsing the output using StrOutputParser to ensure it is in string format. This creates a complete pipeline for handling a question about the GitHub repository, retrieving relevant context, and generating an answer based on that context.
# why do we want to run them in parallel? can't we run them separately n combine? We could run them separately and combine the results, but using RunnableParallel allows us to execute both operations simultaneously, which can be more efficient. When a question is asked, we want to retrieve the relevant context from the repository files and also have the question ready to be processed by the language model. By running these operations in parallel, we can prepare both the context and the question at the same time, which can reduce latency and improve the overall performance of the chat chain. Additionally, it simplifies the code by allowing us to define both operations in a single step rather than having to manage separate steps for retrieving context and handling the question.
# we're returning a chain that can be invoked later with a question input, and when invoked, it will execute the entire sequence of retrieving context, generating the prompt, and getting the answer from the language model. This allows us to create a reusable chat chain that can handle multiple questions without needing to redefine the process each time.

# ── Repo Summary ───────────────────────────────────────────────

SUMMARY_PROMPT = PromptTemplate(
    template="""You are a senior software engineer. Based on the repository code below,
write a concise but comprehensive summary covering:
- Purpose and main functionality
- Tech stack and architecture
- Code quality observations
- Notable patterns or areas of concern

Repository code:
{context}

Write your summary in clear paragraphs.
""",
    input_variables=["context"],
)
# this input variable context will be filled with the formatted documents retrieved from the vector store, which represent the repository code. The language model will then use this context to generate a summary of the repository based on the provided template.
# when we use SUMMARY_PROMPT in the build_summary_chain, we will replace the {context} placeholder with the actual formatted repository code that we retrieve from the vector store. This allows us to create a dynamic prompt that provides the language model with the necessary context to generate a summary of the repository.


def build_summary_chain(vector_store):
    retriever = vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 10})
    return (
        RunnableLambda(lambda _: "Give me a full overview of this repository")
        | RunnableParallel({"context": retriever | RunnableLambda(format_docs)})
        | SUMMARY_PROMPT
        | llm
        | StrOutputParser()
    )
# what's the _ for in lambda? In Python, the underscore (_) is often used as a placeholder variable name when the actual value is not important or will not be used. In this case, the lambda function is defined as lambda _: "Give me a full overview of this repository", which means that it takes an input (represented by the underscore) but ignores it and always returns the same string "Give me a full overview of this repository". This is a common convention to indicate that the input to the lambda function is not relevant to its output.
# TODOs : we should take broader context for summary, like just 10 documents may not be enough to capture the full scope of the repository, especially for larger repositories. We can consider increasing the number of documents retrieved or implementing a more sophisticated method for selecting which documents to include in the context for the summary. This way, we can ensure that the language model has enough information to generate a comprehensive and accurate summary of the repository.
# TODOs : trace flow of data through this chain to understand how it works end-to-end, especially how the context is built and passed to the prompt, and how the final output is generated and parsed.

# ── Contributor Summary ────────────────────────────────────────


CONTRIBUTOR_PROMPT = PromptTemplate(
    template="""You are evaluating a software contributor based on their commit diffs.
Commit diffs for {login}:
{context}

Provide a summary covering:
- Areas of the codebase they work on most
- Nature of their contributions (features, bugs, refactors, docs)
- Overall activity level
- Any notable patterns

Be factual and professional.
""",
    input_variables=["context", "login"],
)
# Todos : refine the prompt myself.


def build_contributor_summary_chain(vector_store, login: str):
    # TODOs : remove logs later
    retriever = vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 8})
    return (
        RunnableLambda(lambda _: login)
        # lambda is used here to create a simple function that takes an input (which is ignored) and returns the login variable. This allows us to pass the login information into the RunnableParallel, where it can be used as part of the context for generating the contributor summary. The retriever will fetch relevant commit diffs based on the login, and then both the context and login will be passed to the CONTRIBUTOR_PROMPT to generate a summary of the contributor's activity and contributions to the codebase.
        | RunnableParallel({
            "context": retriever | RunnableLambda(format_docs),
            "login": RunnablePassthrough(),
        })
        | CONTRIBUTOR_PROMPT
        | llm
        | StrOutputParser()
    )
# we're always starting with runnable in a chain, why? and why not just pass login directly? does chain not work if we just pass login directly to the prompt without using a lambda? The reason we start with a RunnableLambda in the chain is to create a function that can be executed as part of the chain. In this case, we want to pass the login information into the chain so that it can be used in the prompt. By using a lambda function, we can take the login variable and make it available for the RunnableParallel to use when generating the context for the contributor summary. If we were to pass the login directly without using a lambda, it would not be integrated into the chain properly, and we would not be able to use it as part of the context for generating the summary. The lambda allows us to create a step in the chain that provides the necessary information (the login) for subsequent steps to use when generating the output.


# ── Question Generation ────────────────────────────────────────

QUESTION_PROMPT = PromptTemplate(
    template="""You are a technical interviewer. Based on the contributor's commit diffs and the
repository code, generate 5 unique and specific evaluation questions of type: {question_type}.

Guidelines:
- Questions must be specific to THIS contributor's actual work
- Vary difficulty (2 easy, 2 medium, 1 hard)
- For 'scalability': focus on performance and load concerns
- For 'optimization': focus on algorithmic or resource improvements
- For 'ml-usage': focus on ML/AI usage if present, else data processing
- For 'architecture': focus on design decisions
- For 'general': mix of understanding and application

Context:
{context}

Contributor: {login}
Question type: {question_type}

Return ONLY a numbered list of 5 questions, no preamble.
""",
    input_variables=["context", "login", "question_type"],
)


# TODOs : we're not using question type, so we can remove it. instead we can take specific prompt from user about type of questions they want. 
def build_question_chain(vector_store, login: str, question_type: str):
    retriever = vector_store.as_retriever(search_type="similarity", search_kwargs={"k": 6})

    def invoke_chain(_):
        docs = retriever.invoke(f"{login} commit diff code changes {question_type}")
        context = format_docs(docs)
        prompt_value = QUESTION_PROMPT.format(
            context=context, login=login, question_type=question_type
        )
        result = llm.invoke(prompt_value)
        return StrOutputParser().invoke(result)

    return invoke_chain
#  why return function here unlike other chains where we return a Runnable chain? In this case, we are defining a function invoke_chain that encapsulates the entire process of retrieving relevant documents, formatting them, generating a prompt, and invoking the language model to get the final output. By returning this function, we allow the caller to execute the entire question generation process by simply calling the returned function with the appropriate input. This is different from the other chains where we return a Runnable chain that can be executed in a more modular way. Here, we are directly returning a function that performs all the necessary steps in one go when invoked.
# TODOs : can return a chain instead of a function here? we could potentially build a Runnable chain that incorporates the retriever, formatting, prompt generation, and language model invocation in a more modular way, similar to the other chains. This would allow us to maintain consistency in how we structure our chains and make it easier to manage and extend in the future. However, for simplicity and directness in this specific case, returning a function that encapsulates the entire process is also a valid approach. It ultimately depends on how we want to structure our code and whether we anticipate needing more flexibility or modularity in this part of the pipeline.